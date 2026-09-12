package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const (
	quarkDriveBaseURL = "https://drive-pc.quark.cn"
	quarkUserAgent    = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
	maxJSONResponse   = 32 << 20
)

type File struct {
	Fid       string
	Name      string
	IsDir     bool
	Size      int64
	UpdatedAt int64
}

type DownloadStream struct {
	Body io.ReadCloser
	Name string
	Size int64
}

type Client struct {
	httpClient *http.Client
	cookie     string
	baseURL    string
}

func NewQuarkClient(cookie string) (*Client, error) {
	return newQuarkClient(cookie, quarkDriveBaseURL)
}

func newQuarkClient(cookie, baseURL string) (*Client, error) {
	cookie = strings.TrimSpace(cookie)
	if cookie == "" || len(cookie) > 16384 || strings.IndexFunc(cookie, unicode.IsControl) >= 0 {
		return nil, fmt.Errorf("夸克登录 Cookie 无效")
	}
	if _, err := url.ParseRequestURI(baseURL); err != nil {
		return nil, fmt.Errorf("夸克服务地址无效")
	}
	return &Client{
		httpClient: &http.Client{Timeout: 45 * time.Second, Jar: quarkCookieJar(cookie)},
		cookie:     cookie,
		baseURL:    strings.TrimRight(baseURL, "/"),
	}, nil
}

func (c *Client) Test(ctx context.Context) error {
	_, _, err := c.listPage(ctx, "0", 1, 1)
	return err
}

func (c *Client) List(ctx context.Context, parentFid string, offset, limit int) ([]File, bool, error) {
	if offset < 0 {
		offset = 0
	}
	if limit < 1 || limit > 500 {
		limit = 300
	}
	page := offset/limit + 1
	files, hasMore, err := c.listPage(ctx, parentFid, page, limit)
	if err != nil {
		return nil, false, err
	}
	start := offset % limit
	if start >= len(files) {
		return nil, hasMore, nil
	}
	files = files[start:]
	if len(files) > limit {
		files = files[:limit]
	}
	return files, hasMore || len(files) == limit, nil
}

func (c *Client) ListAll(ctx context.Context, parentFid string) ([]File, error) {
	const pageSize = 100
	var all []File
	for page := 1; page <= 10000; page++ {
		files, hasMore, err := c.listPage(ctx, parentFid, page, pageSize)
		if err != nil {
			return nil, err
		}
		all = append(all, files...)
		if !hasMore || len(files) == 0 {
			return all, nil
		}
	}
	return nil, fmt.Errorf("夸克目录项目过多，已停止读取")
}

func (c *Client) CreateFolder(ctx context.Context, parentFid, name string) error {
	name = strings.TrimSpace(name)
	if err := validateName(name, "文件夹名称"); err != nil {
		return err
	}
	if parentFid == "" {
		parentFid = "0"
	}
	_, err := c.requestJSON(ctx, http.MethodPost, "/1/clouddrive/file", nil, map[string]any{
		"dir_init_lock": false,
		"dir_path":      "",
		"file_name":     name,
		"pdir_fid":      parentFid,
	})
	return err
}

func (c *Client) Rename(ctx context.Context, fid, name string) error {
	if err := validateFid(fid); err != nil {
		return err
	}
	if err := validateName(name, "文件名称"); err != nil {
		return err
	}
	_, err := c.requestJSON(ctx, http.MethodPost, "/1/clouddrive/file/rename", nil, map[string]any{
		"fid":       fid,
		"file_name": strings.TrimSpace(name),
	})
	return err
}

func (c *Client) Delete(ctx context.Context, fids []string) error {
	if len(fids) == 0 || len(fids) > 100 {
		return fmt.Errorf("一次最多删除 100 个云端项目")
	}
	for _, fid := range fids {
		if err := validateFid(fid); err != nil {
			return err
		}
	}
	_, err := c.requestJSON(ctx, http.MethodPost, "/1/clouddrive/file/delete", nil, map[string]any{
		"action_type":  2,
		"filelist":     fids,
		"exclude_fids": []string{},
	})
	return err
}

// Download resolves the short-lived provider URL and returns a stream. The
// object-storage URL still uses the Quark login cookie for callback
// validation, so the cookie is kept on the redirected download request.
func (c *Client) Download(ctx context.Context, fid string) (*DownloadStream, error) {
	if err := validateFid(fid); err != nil {
		return nil, err
	}
	raw, err := c.requestJSON(ctx, http.MethodPost, "/1/clouddrive/file/download", nil, map[string]any{"fids": []string{fid}})
	if err != nil {
		return nil, err
	}
	entry, ok := firstDataObject(raw)
	if !ok {
		return nil, fmt.Errorf("夸克下载接口未返回文件地址")
	}
	downloadURL := stringValue(entry, "download_url", "downloadUrl", "url")
	parsed, err := url.Parse(downloadURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, fmt.Errorf("夸克下载地址无效")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("创建云端下载请求失败: %w", err)
	}
	// API calls should fail fast, but the body of a large file download must
	// not be limited by the API client's total request timeout. The context
	// still controls cancellation when the user cancels the task or the
	// server shuts down.
	downloadClient := *c.httpClient
	downloadClient.Timeout = 0
	request.Header.Set("User-Agent", quarkUserAgent)
	request.Header.Set("Cookie", cookieHeaderForURL(c.cookie, downloadClient.Jar, parsed))
	request.Header.Set("Referer", "https://pan.quark.cn/")
	request.Header.Set("Origin", "https://pan.quark.cn")
	response, err := downloadClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("下载云端文件失败: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		response.Body.Close()
		return nil, fmt.Errorf("下载云端文件失败（HTTP %d）", response.StatusCode)
	}
	size := response.ContentLength
	if size < 0 {
		size = intValue(entry, "size", "file_size", "size_bytes")
	}
	return &DownloadStream{Body: response.Body, Name: stringValue(entry, "file_name", "name"), Size: size}, nil
}

func (c *Client) listPage(ctx context.Context, parentFid string, page, size int) ([]File, bool, error) {
	if parentFid == "" {
		parentFid = "0"
	}
	if err := validateFid(parentFid); err != nil {
		return nil, false, err
	}
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 500 {
		size = 100
	}
	query := url.Values{}
	query.Set("pr", "ucpro")
	query.Set("fr", "pc")
	query.Set("uc_param_str", "")
	query.Set("pdir_fid", parentFid)
	query.Set("_page", strconv.Itoa(page))
	query.Set("_size", strconv.Itoa(size))
	query.Set("_sort", "file_name:asc")
	query.Set("_fetch_total", "1")
	raw, err := c.requestJSON(ctx, http.MethodGet, "/1/clouddrive/file/sort", query, nil)
	if err != nil {
		return nil, false, err
	}
	items := extractList(raw)
	files := make([]File, 0, len(items))
	for _, item := range items {
		parsed, ok := parseFile(item)
		if ok {
			files = append(files, parsed)
		}
	}
	hasMore := len(files) >= size
	if total := extractTotal(raw); total >= 0 {
		hasMore = int64((page-1)*size+len(files)) < total
	}
	return files, hasMore, nil
}

func (c *Client) requestJSON(ctx context.Context, method, endpoint string, query url.Values, payload any) (any, error) {
	requestURL, err := url.Parse(c.baseURL + endpoint)
	if err != nil {
		return nil, fmt.Errorf("构造夸克请求失败")
	}
	values := requestURL.Query()
	values.Set("pr", "ucpro")
	values.Set("fr", "pc")
	values.Set("uc_param_str", "")
	for key, list := range query {
		values.Del(key)
		for _, value := range list {
			values.Add(key, value)
		}
	}
	requestURL.RawQuery = values.Encode()

	var body io.Reader
	if payload != nil {
		encoded, marshalErr := json.Marshal(payload)
		if marshalErr != nil {
			return nil, fmt.Errorf("构造夸克请求失败")
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, requestURL.String(), body)
	if err != nil {
		return nil, fmt.Errorf("创建夸克请求失败")
	}
	request.Header.Set("Accept", "application/json, text/plain, */*")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	request.Header.Set("Origin", "https://pan.quark.cn")
	request.Header.Set("Referer", "https://pan.quark.cn/")
	request.Header.Set("User-Agent", quarkUserAgent)
	request.Header.Set("Cookie", c.cookie)
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("连接夸克网盘失败: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxJSONResponse+1))
	if err != nil {
		return nil, fmt.Errorf("读取夸克响应失败")
	}
	if len(data) > maxJSONResponse {
		return nil, fmt.Errorf("夸克响应过大")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("夸克服务返回 HTTP %d", response.StatusCode)
	}
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		return nil, fmt.Errorf("解析夸克响应失败")
	}
	if message := responseError(decoded); message != "" {
		return nil, fmt.Errorf("夸克接口返回错误: %s", message)
	}
	return decoded, nil
}

func validateFid(fid string) error {
	fid = strings.TrimSpace(fid)
	if fid == "" || len(fid) > 256 || strings.IndexFunc(fid, unicode.IsControl) >= 0 || strings.ContainsAny(fid, "/\\") {
		return fmt.Errorf("云端文件标识无效")
	}
	return nil
}

func validateName(name, label string) error {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || len([]byte(name)) > 255 || strings.ContainsAny(name, "/\\") || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return fmt.Errorf("%s无效", label)
	}
	return nil
}

func asMap(value any) (map[string]any, bool) {
	result, ok := value.(map[string]any)
	return result, ok
}

func quarkCookieJar(cookieHeader string) http.CookieJar {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil
	}
	jar.SetCookies(&url.URL{Scheme: "https", Host: "quark.cn", Path: "/"}, parseCookieHeader(cookieHeader))
	return jar
}

func parseCookieHeader(cookieHeader string) []*http.Cookie {
	var cookies []*http.Cookie
	for _, part := range strings.Split(cookieHeader, ";") {
		pieces := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(pieces) != 2 || strings.TrimSpace(pieces[0]) == "" {
			continue
		}
		cookies = append(cookies, &http.Cookie{Name: strings.TrimSpace(pieces[0]), Value: strings.TrimSpace(pieces[1]), Domain: ".quark.cn"})
	}
	return cookies
}

func cookieHeaderForURL(original string, jar http.CookieJar, target *url.URL) string {
	values := make(map[string]string)
	order := make([]string, 0)
	add := func(name, value string) {
		if name == "" {
			return
		}
		if _, exists := values[name]; !exists {
			order = append(order, name)
		}
		values[name] = value
	}
	for _, cookie := range parseCookieHeader(original) {
		add(cookie.Name, cookie.Value)
	}
	if jar != nil && target != nil {
		for _, cookie := range jar.Cookies(target) {
			add(cookie.Name, cookie.Value)
		}
	}
	parts := make([]string, 0, len(order))
	for _, name := range order {
		parts = append(parts, name+"="+values[name])
	}
	return strings.Join(parts, "; ")
}

func asSlice(value any) []any {
	items, _ := value.([]any)
	return items
}

func extractList(raw any) []any {
	if list := listFrom(raw); list != nil {
		return list
	}
	if data, ok := asMap(asMapValue(raw, "data")); ok {
		for _, key := range []string{"list", "items", "file_list"} {
			if list := asSlice(data[key]); list != nil {
				return list
			}
		}
	}
	return nil
}

func listFrom(raw any) []any {
	if items, ok := raw.([]any); ok {
		return items
	}
	if object, ok := asMap(raw); ok {
		for _, key := range []string{"list", "items", "file_list"} {
			if list := asSlice(object[key]); list != nil {
				return list
			}
		}
	}
	return nil
}

func parseFile(value any) (File, bool) {
	object, ok := asMap(value)
	if !ok {
		return File{}, false
	}
	fid := stringValue(object, "fid", "file_id", "id")
	name := stringValue(object, "file_name", "name")
	if fid == "" || name == "" {
		return File{}, false
	}
	fileType := stringValue(object, "file_type", "type")
	isDir := boolValue(object, "is_dir", "isDir", "dir") || fileType == "0" || strings.EqualFold(fileType, "folder") || strings.EqualFold(fileType, "directory")
	return File{
		Fid:       fid,
		Name:      name,
		IsDir:     isDir,
		Size:      intValue(object, "size", "file_size", "size_bytes"),
		UpdatedAt: timestampValue(object, "updated_at", "l_updated_at", "modified_at", "created_at"),
	}, true
}

func firstDataObject(raw any) (map[string]any, bool) {
	if object, ok := asMap(raw); ok {
		if data, ok := object["data"]; ok {
			if list := asSlice(data); len(list) > 0 {
				return asMap(list[0])
			}
			if item, ok := asMap(data); ok {
				return item, true
			}
		}
	}
	return nil, false
}

func responseError(raw any) string {
	object, ok := asMap(raw)
	if !ok {
		return ""
	}
	for _, key := range []string{"status", "code"} {
		if value, exists := object[key]; exists {
			number := intValueValue(value)
			if number != 0 && number != 200 && number != 2000000 {
				return stringValue(object, "message", "msg", "error", "errmsg")
			}
		}
	}
	return ""
}

func extractTotal(raw any) int64 {
	objects := []map[string]any{}
	if object, ok := asMap(raw); ok {
		objects = append(objects, object)
		if data, ok := asMap(object["data"]); ok {
			objects = append(objects, data)
		}
		if metadata, ok := asMap(object["metadata"]); ok {
			objects = append(objects, metadata)
		}
	}
	for _, object := range objects {
		for _, key := range []string{"_total", "total", "count", "total_count"} {
			if value, ok := object[key]; ok {
				return intValueValue(value)
			}
		}
	}
	return -1
}

func asMapValue(value any, key string) any {
	object, ok := asMap(value)
	if !ok {
		return nil
	}
	return object[key]
}

func stringValue(object map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := object[key]
		if !ok || value == nil {
			continue
		}
		switch item := value.(type) {
		case string:
			return item
		case json.Number:
			return item.String()
		default:
			return fmt.Sprint(item)
		}
	}
	return ""
}

func intValue(object map[string]any, keys ...string) int64 {
	for _, key := range keys {
		if value, ok := object[key]; ok {
			return intValueValue(value)
		}
	}
	return 0
}

func intValueValue(value any) int64 {
	switch item := value.(type) {
	case int:
		return int64(item)
	case int64:
		return item
	case float64:
		return int64(item)
	case json.Number:
		n, _ := item.Int64()
		return n
	case string:
		n, _ := strconv.ParseInt(strings.TrimSpace(item), 10, 64)
		return n
	default:
		return 0
	}
}

func boolValue(object map[string]any, keys ...string) bool {
	for _, key := range keys {
		value, ok := object[key]
		if !ok {
			continue
		}
		switch item := value.(type) {
		case bool:
			return item
		case string:
			return item == "1" || strings.EqualFold(item, "true")
		case float64:
			return item != 0
		}
	}
	return false
}

func timestampValue(object map[string]any, keys ...string) int64 {
	value := intValue(object, keys...)
	if value > 1_000_000_000_000 {
		return value / 1000
	}
	return value
}
