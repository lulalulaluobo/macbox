package cloud

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestListParsesQuarkFileShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/1/clouddrive/file/sort" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Cookie"); got != "sid=test" {
			t.Fatalf("unexpected cookie: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"list":[{"fid":"folder-1","file_name":"影视","file_type":0},{"fid":"file-1","file_name":"片段.mp4","file_type":1,"size":1234}],"total":2}}`))
	}))
	defer server.Close()

	client, err := newQuarkClient("sid=test", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	items, more, err := client.List(context.Background(), "0", 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if more || len(items) != 2 {
		t.Fatalf("unexpected listing: %#v, more=%v", items, more)
	}
	if !items[0].IsDir || items[1].IsDir || items[1].Size != 1234 {
		t.Fatalf("unexpected parsed items: %#v", items)
	}
}

func TestValidateNameRejectsPathTraversal(t *testing.T) {
	if err := validateName("../private", "名称"); err == nil {
		t.Fatal("expected path-like cloud name to be rejected")
	}
}

func TestDownloadKeepsCookieOnObjectStorageRequest(t *testing.T) {
	client, err := newQuarkClient("sid=test", "https://api.example.test")
	if err != nil {
		t.Fatal(err)
	}
	client.httpClient = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host == "api.example.test" {
			if request.Method != http.MethodPost || request.URL.Path != "/1/clouddrive/file/download" {
				return nil, fmt.Errorf("unexpected API request: %s %s", request.Method, request.URL)
			}
			if got := request.URL.Query().Get("fids"); got != "file-1" {
				return nil, fmt.Errorf("download request missing fids query: %q", got)
			}
			if got := request.Header.Get("User-Agent"); got != quarkDesktopUserAgent {
				return nil, fmt.Errorf("download request missing desktop user agent: %q", got)
			}
			return jsonResponse(`{"status":200,"data":[{"file_name":"demo.txt","download_url":"https://objects.example.test/demo.txt","size":5}]}`), nil
		}
		if request.URL.Host != "objects.example.test" {
			return nil, fmt.Errorf("unexpected download host: %s", request.URL.Host)
		}
		if got := request.Header.Get("Cookie"); got != "sid=test" {
			return nil, fmt.Errorf("download request lost cookie: %q", got)
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("hello")), Header: make(http.Header), Request: request, ContentLength: 5}, nil
	})}

	stream, err := client.Download(context.Background(), "file-1")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	data, err := io.ReadAll(stream.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" || stream.Name != "demo.txt" || stream.Size != 5 {
		t.Fatalf("unexpected download stream: name=%q size=%d data=%q", stream.Name, stream.Size, data)
	}
}

func TestMoveAndCopyUseQuarkPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || (r.URL.Path != "/1/clouddrive/file/move" && r.URL.Path != "/1/clouddrive/file/copy") {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if got := payload["to_pdir_fid"]; got != "folder-1" {
			t.Fatalf("unexpected target fid: %#v", got)
		}
		if got := payload["action_type"]; got != float64(1) {
			t.Fatalf("unexpected action type: %#v", got)
		}
		items, ok := payload["filelist"].([]any)
		if !ok || len(items) != 2 || items[0] != "file-1" || items[1] != "file-2" {
			t.Fatalf("unexpected file list: %#v", payload["filelist"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":200}`))
	}))
	defer server.Close()
	client, err := newQuarkClient("sid=test", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Copy(context.Background(), []string{"file-1", "file-2"}, "folder-1"); err != nil {
		t.Fatal(err)
	}
	if err := client.Move(context.Background(), []string{"file-1", "file-2"}, "folder-1"); err != nil {
		t.Fatal(err)
	}
}

func TestUploadFileRunsQuarkMultipartFlow(t *testing.T) {
	temp, err := os.CreateTemp("", "quark-upload-test-*")
	if err != nil {
		t.Fatal(err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if _, err := temp.WriteString("hello"); err != nil {
		t.Fatal(err)
	}
	if err := temp.Close(); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/1/clouddrive/file/sort":
			_, _ = w.Write([]byte(`{"status":200,"data":{"list":[{"fid":"file-created","file_name":"hello.txt","file_type":1,"size":5}],"total":1}}`))
		case "/1/clouddrive/file/upload/pre":
			_, _ = w.Write([]byte(`{"status":200,"data":{"task_id":"task-1","fid":"file-created","auth_info":"auth-1","upload_id":"upload-1","obj_key":"object-1","bucket":"bucket-1","upload_url":"http://pds.quark.cn","callback":{"callbackUrl":"https://api.example.test/callback"},"metadata":{"part_size":1048576}}}`))
		case "/1/clouddrive/file/update/hash":
			_, _ = w.Write([]byte(`{"status":200,"data":{"finish":false}}`))
		case "/1/clouddrive/file/upload/auth":
			_, _ = w.Write([]byte(`{"status":200,"data":{"auth_key":"signature"}}`))
		case "/1/clouddrive/file/upload/finish":
			_, _ = w.Write([]byte(`{"status":200}`))
		default:
			t.Fatalf("unexpected API path: %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client, err := newQuarkClient("sid=test", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	client.httpClient = &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host == "bucket-1.pds.quark.cn" {
			if request.Method == http.MethodPut {
				return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("")), Header: http.Header{"Etag": []string{`"etag-1"`}}, Request: request}, nil
			}
			if request.Method == http.MethodPost {
				if request.Header.Get("Content-MD5") == "" {
					return nil, fmt.Errorf("complete upload request missing Content-MD5")
				}
				return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header), Request: request}, nil
			}
		}
		return http.DefaultTransport.RoundTrip(request)
	})}
	var progress int64
	if err := client.UploadFile(context.Background(), tempPath, "folder-1", "hello.txt", func(done, _ int64) { progress = done }); err != nil {
		t.Fatal(err)
	}
	if progress != 5 {
		t.Fatalf("unexpected upload progress: %d", progress)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func jsonResponse(body string) *http.Response {
	return &http.Response{
		StatusCode:    http.StatusOK,
		Body:          io.NopCloser(strings.NewReader(body)),
		Header:        http.Header{"Content-Type": []string{"application/json"}},
		ContentLength: int64(len(body)),
	}
}
