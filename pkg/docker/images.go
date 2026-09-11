package docker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
)

// Docker image references are passed as one argv item to docker. Keep the
// accepted grammar deliberately conservative so an image field can never turn
// into an option or shell expression.
var validImageReference = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/@:-]{0,255}$`)

func (c *Client) ListImages(ctx context.Context) ([]ImageInfo, error) {
	out, err := c.runDockerCmd(ctx, "images", "--format", "{{json .}}")
	if err != nil {
		return nil, fmt.Errorf("failed to list images: %w", err)
	}

	var images []ImageInfo
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var raw map[string]interface{}
		if err := json.Unmarshal([]byte(line), &raw); err == nil {
			id := getString(raw, "ID")
			repo := getString(raw, "Repository")
			tag := getString(raw, "Tag")
			size := getString(raw, "Size")
			createdSince := getString(raw, "CreatedSince")
			createdAt := getString(raw, "CreatedAt")
			containersStr := getString(raw, "Containers")

			containersCount := 0
			if containersStr != "" && containersStr != "N/A" {
				containersCount, _ = strconv.Atoi(containersStr)
			}

			// Parse approximate size bytes
			var sizeBytes int64 = 0
			lowerSize := strings.ToLower(size)
			if strings.HasSuffix(lowerSize, "gb") {
				if val, err := strconv.ParseFloat(strings.TrimSuffix(lowerSize, "gb"), 64); err == nil {
					sizeBytes = int64(val * 1024 * 1024 * 1024)
				}
			} else if strings.HasSuffix(lowerSize, "mb") {
				if val, err := strconv.ParseFloat(strings.TrimSuffix(lowerSize, "mb"), 64); err == nil {
					sizeBytes = int64(val * 1024 * 1024)
				}
			} else if strings.HasSuffix(lowerSize, "kb") {
				if val, err := strconv.ParseFloat(strings.TrimSuffix(lowerSize, "kb"), 64); err == nil {
					sizeBytes = int64(val * 1024)
				}
			}

			img := ImageInfo{
				ID:           id,
				Repository:   repo,
				Tag:          tag,
				Size:         size,
				SizeBytes:    sizeBytes,
				CreatedAt:    createdAt,
				CreatedSince: createdSince,
				Containers:   containersCount,
				InUse:        containersCount > 0,
			}
			images = append(images, img)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取镜像列表失败: %w", err)
	}

	return images, nil
}

func (c *Client) PullImage(ctx context.Context, imageName string, out io.Writer) error {
	imageName = strings.TrimSpace(imageName)
	if !validImageReference.MatchString(imageName) {
		return fmt.Errorf("镜像名称格式无效")
	}

	fmt.Fprintf(out, "📦 准备拉取 Docker 镜像: %s\n", imageName)
	err := c.vmMgr.ExecStream(ctx, out, "docker", "pull", imageName)
	if err != nil {
		fmt.Fprintf(out, "❌ 拉取失败: %v\n", err)
		return err
	}
	fmt.Fprintf(out, "✅ 镜像拉取完成: %s\n", imageName)
	return nil
}

func (c *Client) RemoveImage(ctx context.Context, imageID string, force bool) error {
	imageID = strings.TrimSpace(imageID)
	if !validImageReference.MatchString(imageID) {
		return fmt.Errorf("镜像 ID 或名称格式无效")
	}
	args := []string{"rmi"}
	if force {
		args = append(args, "-f")
	}
	args = append(args, imageID)
	_, err := c.runDockerCmd(ctx, args...)
	return err
}

func (c *Client) PruneImages(ctx context.Context) (string, error) {
	out, err := c.runDockerCmd(ctx, "image", "prune", "-f")
	if err != nil {
		return "", err
	}
	return string(out), nil
}
