package cloud

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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
