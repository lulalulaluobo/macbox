package cloud

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/skip2/go-qrcode"
)

const (
	quarkAuthBaseURL = "https://uop.quark.cn"
	quarkPanBaseURL  = "https://pan.quark.cn"
	quarkClientID    = "532"
)

// QRLoginChallenge is intentionally short-lived and contains no account
// credentials. The browser uses the image URL to render a local QR code.
type QRLoginChallenge struct {
	Token     string
	URL       string
	ExpiresAt time.Time
}

type QRLoginResult struct {
	Pending bool
	Cookie  string
	Account string
}

func BeginQuarkQRLogin(ctx context.Context) (QRLoginChallenge, error) {
	requestID := newRequestID()
	query := url.Values{
		"client_id":  {quarkClientID},
		"v":          {"1.2"},
		"request_id": {requestID},
	}
	var response map[string]any
	if err := quarkAuthJSON(ctx, http.MethodGet, quarkAuthBaseURL+"/cas/ajax/getTokenForQrcodeLogin", query, &response); err != nil {
		return QRLoginChallenge{}, err
	}
	data, _ := response["data"].(map[string]any)
	members, _ := data["members"].(map[string]any)
	token := stringValue(members, "token")
	if token == "" {
		return QRLoginChallenge{}, fmt.Errorf("夸克未返回扫码登录令牌")
	}
	expiresAt := time.Now().UTC().Add(3 * time.Minute)
	qrURL := "https://su.quark.cn/4_eMHBJ?" + url.Values{
		"token":        {token},
		"client_id":    {quarkClientID},
		"ssb":          {"weblogin"},
		"uc_param_str": {""},
	}.Encode()
	return QRLoginChallenge{Token: token, URL: qrURL, ExpiresAt: expiresAt}, nil
}

func PollQuarkQRLogin(ctx context.Context, token string) (QRLoginResult, error) {
	if strings.TrimSpace(token) == "" {
		return QRLoginResult{}, fmt.Errorf("扫码登录令牌为空")
	}
	query := url.Values{
		"client_id":  {quarkClientID},
		"v":          {"1.2"},
		"token":      {token},
		"request_id": {newRequestID()},
	}
	var response map[string]any
	if err := quarkAuthJSON(ctx, http.MethodGet, quarkAuthBaseURL+"/cas/ajax/getServiceTicketByQrcodeToken", query, &response); err != nil {
		return QRLoginResult{}, err
	}
	data, _ := response["data"].(map[string]any)
	members, _ := data["members"].(map[string]any)
	ticket := stringValue(members, "service_ticket", "serviceTicket")
	if ticket == "" {
		return QRLoginResult{Pending: true}, nil
	}

	accountURL := quarkPanBaseURL + "/account/info?" + url.Values{"st": {ticket}, "lw": {"scan"}}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, accountURL, nil)
	if err != nil {
		return QRLoginResult{}, fmt.Errorf("创建夸克登录请求失败")
	}
	setQuarkHeaders(request)
	client := &http.Client{Timeout: 20 * time.Second}
	accountResponse, err := client.Do(request)
	if err != nil {
		return QRLoginResult{}, fmt.Errorf("确认夸克登录失败: %w", err)
	}
	defer accountResponse.Body.Close()
	if accountResponse.StatusCode < 200 || accountResponse.StatusCode >= 300 {
		return QRLoginResult{}, fmt.Errorf("确认夸克登录失败（HTTP %d）", accountResponse.StatusCode)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(accountResponse.Body, 2<<20))
	cookies := make([]string, 0, len(accountResponse.Cookies()))
	for _, cookie := range accountResponse.Cookies() {
		if cookie.Name != "" {
			cookies = append(cookies, cookie.Name+"="+cookie.Value)
		}
	}
	if len(cookies) == 0 {
		return QRLoginResult{}, fmt.Errorf("夸克登录成功但未返回会话信息")
	}

	return QRLoginResult{Cookie: strings.Join(cookies, "; "), Account: "夸克账号"}, nil
}

func QuarkQRPNG(content string) ([]byte, error) {
	if strings.TrimSpace(content) == "" {
		return nil, fmt.Errorf("二维码内容为空")
	}
	return qrcode.Encode(content, qrcode.Medium, 360)
}

func quarkAuthJSON(ctx context.Context, method, rawURL string, query url.Values, target any) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("构造夸克登录请求失败")
	}
	parsed.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, method, parsed.String(), nil)
	if err != nil {
		return fmt.Errorf("创建夸克登录请求失败")
	}
	setQuarkHeaders(request)
	client := &http.Client{Timeout: 20 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("连接夸克登录服务失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("夸克登录服务返回 HTTP %d", response.StatusCode)
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 4<<20))
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("解析夸克登录响应失败")
	}
	return nil
}

func setQuarkHeaders(request *http.Request) {
	request.Header.Set("Accept", "application/json, text/plain, */*")
	request.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	request.Header.Set("Origin", quarkPanBaseURL)
	request.Header.Set("Referer", quarkPanBaseURL+"/")
	request.Header.Set("User-Agent", quarkUserAgent)
}

func newRequestID() string {
	return fmt.Sprintf("macbox-%d", time.Now().UnixNano())
}
