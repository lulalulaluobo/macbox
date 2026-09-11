.PHONY: all build build-web build-backend release-mac dev test clean

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

release-mac:
	@echo "==> 构建 macOS 正式版 DMG..."
	bash scripts/build-mac-dmg.sh

dev-backend:
	@echo "==> 启动 Go 后端开发服务..."
	CGO_ENABLED=0 go run ./cmd/macnas

dev-web:
	@echo "==> 启动前端开发调试服务器 (http://localhost:3000)..."
	cd web && npm run dev

test:
	@echo "==> 运行后端单元测试..."
	CGO_ENABLED=0 go test ./pkg/... -v

clean:
	rm -rf bin web/dist
