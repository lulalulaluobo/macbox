package cloud

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const (
	quarkDriveBaseURL     = "https://drive-pc.quark.cn"
	quarkUserAgent        = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
	quarkDesktopUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.56 Chrome/100.0.4896.160 Electron/18.3.5.12-a038f7b798 Safari/537.36 Channel/pckk_other_ch"
	maxJSONResponse       = 32 << 20
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

type UploadProgress func(done, total int64)

const (
	quarkUploadUserAgent = "aliyun-sdk-js/6.6.1"
	quarkUploadPartSize  = int64(4 << 20)
)

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
	if err := validateFids(fids, "删除"); err != nil {
		return err
	}
	_, err := c.requestJSON(ctx, http.MethodPost, "/1/clouddrive/file/delete", nil, map[string]any{
		"action_type":  2,
		"filelist":     fids,
		"exclude_fids": []string{},
	})
	return err
}

func (c *Client) Move(ctx context.Context, fids []string, targetFid string) error {
	return c.fileTransfer(ctx, "/1/clouddrive/file/move", fids, targetFid)
}

func (c *Client) Copy(ctx context.Context, fids []string, targetFid string) error {
	return c.fileTransfer(ctx, "/1/clouddrive/file/copy", fids, targetFid)
}

func (c *Client) fileTransfer(ctx context.Context, endpoint string, fids []string, targetFid string) error {
	if err := validateFids(fids, "操作"); err != nil {
		return err
	}
	if targetFid == "" {
		targetFid = "0"
	}
	if err := validateFid(targetFid); err != nil {
		return err
	}
	_, err := c.requestJSON(ctx, http.MethodPost, endpoint, nil, map[string]any{
		"action_type":  1,
		"to_pdir_fid":  targetFid,
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
	query := url.Values{}
	// Quark validates fids in both places. Sending only the JSON body results
	// in HTTP 400 on the current drive-pc endpoint.
	query.Set("fids", fid)
	raw, err := c.requestJSONWithUserAgent(ctx, http.MethodPost, "/1/clouddrive/file/download", query, map[string]any{"fids": []string{fid}}, quarkDesktopUserAgent)
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

// UploadFile uploads one local file to a Quark folder. The caller owns the
// local file and may use progress to persist a transfer status in its job UI.
func (c *Client) UploadFile(ctx context.Context, localPath, parentFid, fileName string, progress UploadProgress) error {
	if strings.TrimSpace(parentFid) == "" {
		parentFid = "0"
	}
	if err := validateFid(parentFid); err != nil {
		return err
	}
	if err := validateName(fileName, "文件名称"); err != nil {
		return err
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("读取待上传文件失败: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("只能上传普通文件")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	md5Sum, sha1Sum, err := fileHashes(localPath)
	if err != nil {
		return err
	}
	contentType := mime.TypeByExtension(filepath.Ext(fileName))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	now := time.Now().UnixMilli()
	preRaw, err := c.requestJSON(ctx, http.MethodPost, "/1/clouddrive/file/upload/pre", nil, map[string]any{
		"ccp_hash_update": true,
		"parallel_upload": true,
		"dir_name":        "",
		"file_name":       fileName,
		"format_type":     contentType,
		"l_created_at":    now,
		"l_updated_at":    now,
		"pdir_fid":        parentFid,
		"size":            info.Size(),
	})
	if err != nil {
		return fmt.Errorf("上传预处理失败: %w", err)
	}
	pre, ok := firstDataObject(preRaw)
	if !ok {
		return fmt.Errorf("夸克上传预处理未返回任务信息")
	}
	taskID := stringValue(pre, "task_id", "taskId")
	fileID := stringValue(pre, "fid", "file_id", "fileId")
	if taskID == "" {
		return fmt.Errorf("夸克上传预处理缺少任务标识")
	}
	hashRaw, err := c.requestJSON(ctx, http.MethodPost, "/1/clouddrive/file/update/hash", nil, map[string]any{
		"task_id": taskID,
		"md5":     md5Sum,
		"sha1":    sha1Sum,
	})
	if err != nil {
		return fmt.Errorf("上传哈希校验失败: %w", err)
	}
	if responseFinish(hashRaw) {
		if err := c.waitForUploadedFile(ctx, parentFid, fileID, fileName, info.Size()); err != nil {
			return err
		}
		if progress != nil {
			progress(info.Size(), info.Size())
		}
		return nil
	}

	objKey := stringValue(pre, "obj_key", "objKey")
	uploadID := stringValue(pre, "upload_id", "uploadId")
	authInfo := stringValue(pre, "auth_info", "authInfo")
	bucket := stringValue(pre, "bucket")
	if objKey == "" || uploadID == "" || authInfo == "" {
		return fmt.Errorf("夸克上传预处理返回信息不完整")
	}
	if bucket == "" {
		bucket = "ul-zb"
	}
	metadata, _ := asMap(pre["metadata"])
	partSize := intValue(metadata, "part_size", "partSize")
	if partSize < 1<<20 || partSize > 64<<20 {
		partSize = quarkUploadPartSize
	}
	uploadBase, err := normalizeUploadBase(stringValue(pre, "upload_url", "uploadUrl"), bucket)
	if err != nil {
		return err
	}

	file, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("打开待上传文件失败: %w", err)
	}
	defer file.Close()
	parts, err := c.uploadParts(ctx, file, info.Size(), contentType, uploadBase, bucket, objKey, uploadID, authInfo, taskID, partSize, progress)
	if err != nil {
		return err
	}
	if err := c.completeUpload(ctx, contentType, uploadBase, bucket, objKey, uploadID, authInfo, taskID, pre["callback"], parts); err != nil {
		return err
	}
	_, err = c.requestJSON(ctx, http.MethodPost, "/1/clouddrive/file/upload/finish", nil, map[string]any{
		"task_id": taskID,
		"obj_key": objKey,
	})
	if err != nil {
		return fmt.Errorf("确认夸克上传失败: %w", err)
	}
	if err := c.waitForUploadedFile(ctx, parentFid, fileID, fileName, info.Size()); err != nil {
		return err
	}
	if progress != nil {
		progress(info.Size(), info.Size())
	}
	return nil
}

func (c *Client) waitForUploadedFile(ctx context.Context, parentFid, expectedFid, fileName string, size int64) error {
	for attempt := 0; attempt < 12; attempt++ {
		items, err := c.ListAll(ctx, parentFid)
		if err == nil {
			for _, item := range items {
				if item.IsDir {
					continue
				}
				if (expectedFid != "" && item.Fid == expectedFid) || (expectedFid == "" && item.Name == fileName && item.Size == size) {
					return nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return fmt.Errorf("夸克已接收上传数据，但文件尚未出现在目标目录，请稍后刷新重试")
}

type uploadedPart struct {
	Number int
	ETag   string
}

func (c *Client) uploadParts(ctx context.Context, file *os.File, total int64, contentType, uploadBase, bucket, objKey, uploadID, authInfo, taskID string, partSize int64, progress UploadProgress) ([]uploadedPart, error) {
	partCount := int64(1)
	if total > 0 {
		partCount = (total + partSize - 1) / partSize
	}
	parts := make([]uploadedPart, 0, partCount)
	var done int64
	for number := int64(1); number <= partCount; number++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		length := partSize
		if remaining := total - done; remaining >= 0 && remaining < length {
			length = remaining
		}
		data := make([]byte, length)
		if length > 0 {
			if _, err := io.ReadFull(file, data); err != nil {
				return nil, fmt.Errorf("读取上传分片失败: %w", err)
			}
		}
		date := time.Now().UTC().Format(http.TimeFormat)
		resource := fmt.Sprintf("/%s/%s?partNumber=%d&uploadId=%s", bucket, objKey, number, url.QueryEscape(uploadID))
		auth, err := c.uploadAuth(ctx, authInfo, taskID, fmt.Sprintf("PUT\n\n%s\n%s\nx-oss-date:%s\nx-oss-user-agent:%s\n%s", contentType, date, date, quarkUploadUserAgent, resource))
		if err != nil {
			return nil, fmt.Errorf("获取上传分片授权失败: %w", err)
		}
		requestURL, err := objectURL(uploadBase, objKey, map[string]string{"partNumber": strconv.FormatInt(number, 10), "uploadId": uploadID})
		if err != nil {
			return nil, err
		}
		response, err := c.ossRequest(ctx, http.MethodPut, requestURL, auth, contentType, date, "", "", bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return nil, fmt.Errorf("上传第 %d 个分片失败: %w", number, err)
		}
		etag := strings.Trim(response.Header.Get("ETag"), "\"")
		response.Body.Close()
		if etag == "" {
			return nil, fmt.Errorf("上传第 %d 个分片未返回 ETag", number)
		}
		done += int64(len(data))
		parts = append(parts, uploadedPart{Number: int(number), ETag: etag})
		if progress != nil {
			progress(done, total)
		}
	}
	return parts, nil
}

func (c *Client) completeUpload(ctx context.Context, contentType, uploadBase, bucket, objKey, uploadID, authInfo, taskID string, callback any, parts []uploadedPart) error {
	type part struct {
		PartNumber int    `xml:"PartNumber"`
		ETag       string `xml:"ETag"`
	}
	type complete struct {
		XMLName xml.Name `xml:"CompleteMultipartUpload"`
		Parts   []part   `xml:"Part"`
	}
	payload := complete{Parts: make([]part, 0, len(parts))}
	for _, item := range parts {
		payload.Parts = append(payload.Parts, part{PartNumber: item.Number, ETag: item.ETag})
	}
	body, err := xml.Marshal(payload)
	if err != nil {
		return fmt.Errorf("构造上传完成请求失败: %w", err)
	}
	contentMD5 := md5.Sum(body)
	contentMD5Base64 := base64.StdEncoding.EncodeToString(contentMD5[:])
	callbackBytes, err := json.Marshal(callback)
	if err != nil {
		return fmt.Errorf("构造上传回调失败: %w", err)
	}
	callbackBase64 := base64.StdEncoding.EncodeToString(callbackBytes)
	date := time.Now().UTC().Format(http.TimeFormat)
	resource := fmt.Sprintf("/%s/%s?uploadId=%s", bucket, objKey, url.QueryEscape(uploadID))
	auth, err := c.uploadAuth(ctx, authInfo, taskID, fmt.Sprintf("POST\n%s\napplication/xml\n%s\nx-oss-callback:%s\nx-oss-date:%s\nx-oss-user-agent:%s\n%s", contentMD5Base64, date, callbackBase64, date, quarkUploadUserAgent, resource))
	if err != nil {
		return fmt.Errorf("获取上传合并授权失败: %w", err)
	}
	requestURL, err := objectURL(uploadBase, objKey, map[string]string{"uploadId": uploadID})
	if err != nil {
		return err
	}
	response, err := c.ossRequest(ctx, http.MethodPost, requestURL, auth, "application/xml", date, callbackBase64, contentMD5Base64, bytes.NewReader(body), int64(len(body)))
	if err != nil {
		return fmt.Errorf("合并上传分片失败: %w", err)
	}
	response.Body.Close()
	return nil
}

func (c *Client) uploadAuth(ctx context.Context, authInfo, taskID, authMeta string) (string, error) {
	raw, err := c.requestJSON(ctx, http.MethodPost, "/1/clouddrive/file/upload/auth", nil, map[string]any{
		"auth_info": authInfo,
		"auth_meta": authMeta,
		"task_id":   taskID,
	})
	if err != nil {
		return "", err
	}
	data, ok := firstDataObject(raw)
	if !ok {
		return "", fmt.Errorf("授权响应格式无效")
	}
	key := stringValue(data, "auth_key", "authKey", "authorization")
	if key == "" {
		return "", fmt.Errorf("授权响应缺少签名")
	}
	return key, nil
}

func (c *Client) ossRequest(ctx context.Context, method, rawURL, authorization, contentType, date, callback, contentMD5 string, body io.Reader, contentLength int64) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, rawURL, body)
	if err != nil {
		return nil, fmt.Errorf("创建对象存储请求失败: %w", err)
	}
	request.ContentLength = contentLength
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Referer", "https://pan.quark.cn/")
	request.Header.Set("User-Agent", quarkUserAgent)
	request.Header.Set("x-oss-date", date)
	request.Header.Set("x-oss-user-agent", quarkUploadUserAgent)
	if contentMD5 != "" {
		request.Header.Set("Content-MD5", contentMD5)
	}
	if callback != "" {
		request.Header.Set("x-oss-callback", callback)
	}
	client := *c.httpClient
	client.Timeout = 0
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4<<10))
		return nil, fmt.Errorf("对象存储返回 HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	return response, nil
}

func fileHashes(localPath string) (string, string, error) {
	file, err := os.Open(localPath)
	if err != nil {
		return "", "", fmt.Errorf("打开待上传文件失败: %w", err)
	}
	defer file.Close()
	md5Hash, sha1Hash := md5.New(), sha1.New()
	if _, err := io.Copy(io.MultiWriter(md5Hash, sha1Hash), file); err != nil {
		return "", "", fmt.Errorf("计算上传文件哈希失败: %w", err)
	}
	return fmt.Sprintf("%x", md5Hash.Sum(nil)), fmt.Sprintf("%x", sha1Hash.Sum(nil)), nil
}

func objectURL(baseURL, objKey string, query map[string]string) (string, error) {
	parsed, err := url.Parse(strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(objKey, "/"))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return "", fmt.Errorf("夸克对象存储地址无效")
	}
	values := parsed.Query()
	for key, value := range query {
		values.Set(key, value)
	}
	parsed.RawQuery = values.Encode()
	return parsed.String(), nil
}

func normalizeUploadBase(raw, bucket string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "https://pds.quark.cn"
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" {
		return "", fmt.Errorf("夸克上传地址无效")
	}
	if parsed.Scheme == "http" {
		parsed.Scheme = "https"
	}
	if parsed.Scheme != "https" {
		return "", fmt.Errorf("夸克上传地址无效")
	}
	host := parsed.Hostname()
	if !strings.HasSuffix(strings.ToLower(host), ".quark.cn") && !strings.EqualFold(host, "quark.cn") {
		return "", fmt.Errorf("夸克上传地址无效")
	}
	if bucket != "" && !strings.HasPrefix(strings.ToLower(host), strings.ToLower(bucket)+".") {
		host = bucket + "." + host
	}
	parsed.Host = host
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return strings.TrimRight(parsed.String(), "/"), nil
}

func validateHTTPSURL(raw, label string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return fmt.Errorf("%s无效", label)
	}
	return nil
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
	return c.requestJSONWithUserAgent(ctx, method, endpoint, query, payload, quarkUserAgent)
}

func (c *Client) requestJSONWithUserAgent(ctx context.Context, method, endpoint string, query url.Values, payload any, userAgent string) (any, error) {
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
	request.Header.Set("User-Agent", userAgent)
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
	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, fmt.Errorf("夸克服务返回 HTTP %d", response.StatusCode)
		}
		return nil, fmt.Errorf("解析夸克响应失败")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if message := responseError(decoded); message != "" {
			return nil, fmt.Errorf("夸克接口返回错误: %s", message)
		}
		return nil, fmt.Errorf("夸克服务返回 HTTP %d", response.StatusCode)
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

func validateFids(fids []string, operation string) error {
	if len(fids) == 0 || len(fids) > 100 {
		return fmt.Errorf("一次最多%s 100 个云端项目", operation)
	}
	for _, fid := range fids {
		if err := validateFid(fid); err != nil {
			return err
		}
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

func responseFinish(raw any) bool {
	if object, ok := asMap(raw); ok {
		if boolValue(object, "finish", "finished") {
			return true
		}
		if data, ok := asMap(object["data"]); ok {
			return boolValue(data, "finish", "finished")
		}
	}
	return false
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
