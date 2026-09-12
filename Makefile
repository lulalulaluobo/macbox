.PHONY: all build build-web build-backend build-mac-menu release-mac release-mac-cli dev dev-backend dev-backend-lan dev-web test clean

all: build

build-web:
	@echo "==> 构建前端应用 (Vite React Tailwind)..."
	cd web && npm run build

build-backend:
	@echo "==> 编译 Go 后端二进制 (bin/macnas)..."
	mkdir -p bin
	CGO_ENABLED=0 go build -o bin/macnas ./cmd/macnas

build: build-web build-backend
	@echo "==> MacNAS 构建完成！运行 ./bin/macnas 即可启动。"

build-mac-menu:
	@echo "==> 构建 macOS 顶部菜单栏助手..."
	bash scripts/build-macos-menu-app.sh

release-mac:
	@echo "==> 构建 macOS Web 服务发行包..."
	bash scripts/build-mac-release.sh

release-mac-cli: release-mac

dev-backend:
	@echo "==> 启动 Go 后端开发服务..."
	CGO_ENABLED=0 go run ./cmd/macnas

dev-backend-lan:
	@echo "==> 启动可供局域网访问的 Go Web 服务..."
	CGO_ENABLED=0 go run ./cmd/macnas --lan

dev-web:
	@echo "==> 启动前端开发调试服务器 (http://localhost:3000)..."
	cd web && npm run dev

test:
	@echo "==> 运行后端单元测试..."
	CGO_ENABLED=0 go test ./pkg/... -v

clean:
	rm -rf bin web/dist
