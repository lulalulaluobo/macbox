package terminal

import "testing"

// 容器名最终作为 docker exec 的独立参数传递，validContainerRef 是防止
// 命令结构被外部输入改变的第一道校验。对应审查报告的注入元字符测试缺口。
func TestValidContainerRefAcceptsDockerNames(t *testing.T) {
	valid := []string{
		"jellyfin",
		"macnas-jellyfin-1",
		"my_app.v2",
		"App.1",
		"a",
		"0abc",
		"a1234",
	}
	for _, name := range valid {
		if !validContainerRef.MatchString(name) {
			t.Errorf("validContainerRef(%q) = false, want true", name)
		}
	}
}

func TestValidContainerRefRejectsShellMetacharacters(t *testing.T) {
	invalid := []string{
		"",
		";id",
		"jellyfin;id",
		"jellyfin && reboot",
		"$(id)",
		"`id`",
		"jellyfin|cat /etc/passwd",
		"jellyfin\nrm -rf /",
		"jel\\lfin",
		"jel lfin",
		"'jellyfin'",
		"\"jellyfin\"",
		"jellyfin${IFS}",
		"-flags-first",
		".hidden",
		"_underscore",
		"jellyfin#comment",
		"jellyfin\x00",
		"jellyfin\x1b[2J",
	}
	for _, name := range invalid {
		if validContainerRef.MatchString(name) {
			t.Errorf("validContainerRef(%q) = true, want false", name)
		}
	}

	// 长度上限 128：首字符 + 127 个续字符。
	if validContainerRef.MatchString("a" + repeat("a", 128)) {
		t.Error("container ref longer than 128 bytes should be rejected")
	}
	if !validContainerRef.MatchString("a" + repeat("a", 127)) {
		t.Error("128-byte container ref should be accepted")
	}
}

func repeat(s string, n int) string {
	out := make([]byte, 0, len(s)*n)
	for i := 0; i < n; i++ {
		out = append(out, s...)
	}
	return string(out)
}
