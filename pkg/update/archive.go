package update

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func extractTar(source, destination string) error {
	file, err := os.Open(source)
	if err != nil {
		return err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer gz.Close()
	reader := tar.NewReader(gz)
	var total int64
	for {
		header, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		clean := filepath.Clean(header.Name)
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return fmt.Errorf("发行包包含越界路径")
		}
		target := filepath.Join(destination, clean)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			total += header.Size
			if header.Size < 0 || total > maxDownloadBytes {
				return fmt.Errorf("解包超过大小限制")
			}
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			mode := os.FileMode(0644)
			if header.Mode&0111 != 0 {
				mode = 0755
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
			if err != nil {
				return err
			}
			_, copyErr := io.CopyN(out, reader, header.Size)
			closeErr := out.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		default:
			return fmt.Errorf("发行包包含不支持的链接或特殊文件")
		}
	}
}

func copyTree(source, destination string, excluded map[string]bool) error {
	var total int64
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if excluded != nil && excluded[rel] {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("升级内容包含符号链接: %s", rel)
		}
		target := filepath.Join(destination, rel)
		if entry.IsDir() {
			if info, err := os.Lstat(target); err == nil && (!info.IsDir() || info.Mode()&os.ModeSymlink != 0) {
				return fmt.Errorf("目标目录包含链接")
			}
			return os.MkdirAll(target, 0700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("不支持的升级文件")
		}
		total += info.Size()
		if total > maxDownloadBytes {
			return fmt.Errorf("升级内容超过大小限制")
		}
		return copyFile(path, target, info.Mode().Perm())
	})
}

func copyFile(source, target string, mode os.FileMode) error {
	if info, err := os.Lstat(target); err == nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0) {
		return fmt.Errorf("目标文件不可安全替换")
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	closeErr := out.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func unpack(ctx context.Context, release *Release, archive, taskDir, stage string) (string, error) {
	var app string
	if strings.HasSuffix(release.Asset, ".dmg") {
		mount := filepath.Join(taskDir, "mount")
		if err := os.MkdirAll(mount, 0700); err != nil {
			return "", err
		}
		if out, err := exec.CommandContext(ctx, "/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", mount, archive).CombinedOutput(); err != nil {
			return "", fmt.Errorf("读取更新镜像失败: %s (%w)", out, err)
		}
		defer exec.Command("/usr/bin/hdiutil", "detach", mount).Run()
		app = filepath.Join(mount, "MacBoxMemu.app")
		if out, err := exec.CommandContext(ctx, "/usr/bin/codesign", "--verify", "--deep", "--strict", app).CombinedOutput(); err != nil {
			return "", fmt.Errorf("应用组件验证失败: %s (%w)", out, err)
		}
		if err := copyTree(filepath.Join(app, "Contents", "Resources", "runtime"), stage, nil); err != nil {
			return "", err
		}
		if err := os.MkdirAll(filepath.Join(stage, "bin"), 0755); err != nil {
			return "", err
		}
		if err := copyFile(filepath.Join(app, "Contents", "Helpers", "macbox"), filepath.Join(stage, "bin", "macbox"), 0755); err != nil {
			return "", err
		}
		newApp := filepath.Join(taskDir, "new-menu.app")
		if err := copyTree(app, newApp, nil); err != nil {
			return "", err
		}
		app = newApp
	} else {
		dest := filepath.Join(taskDir, "unpack")
		if err := os.MkdirAll(dest, 0700); err != nil {
			return "", err
		}
		if err := extractTar(archive, dest); err != nil {
			return "", err
		}
		root := filepath.Join(dest, strings.TrimSuffix(release.Asset, ".tar.gz"))
		if err := copyTree(root, stage, nil); err != nil {
			return "", err
		}
		app = filepath.Join(stage, "MacBoxMemu.app")
	}
	binary := filepath.Join(stage, "bin", "macbox")
	arch, err := exec.CommandContext(ctx, "/usr/bin/lipo", "-archs", binary).Output()
	if err != nil {
		return "", fmt.Errorf("更新包没有可执行后台")
	}
	expected := "arm64"
	if runtime.GOARCH == "amd64" {
		expected = "x86_64"
	}
	if !strings.Contains(string(arch), expected) {
		return "", fmt.Errorf("更新包 CPU 架构不匹配")
	}
	probeCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	version, err := exec.CommandContext(probeCtx, binary, "--version").Output()
	if err != nil || strings.TrimSpace(string(version)) != release.Version {
		return "", fmt.Errorf("更新包后台版本与发行版本不一致")
	}
	if info, err := os.Stat(filepath.Join(stage, "templates", "vm", "macbox.yaml.tmpl")); err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("更新包缺少虚拟机模板")
	}
	return app, nil
}
