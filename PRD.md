# MacNAS MVP PRD v0.1

## 1. 产品目标

让用户在 macOS 上安装一个管理程序后，通过 Web UI 将 Mac mini 变成基础家庭服务器。

第一版不追求替代大型商业系统，只验证核心闭环：

**磁盘 → Linux VM → Docker → NAS共享 → Web管理**

---

## 2. MVP 核心功能

### ① 首页

显示：

* CPU / 内存使用率
* Mac 运行状态
* Lima VM 状态
* Docker 状态
* 数据盘容量
* IP 地址

提供：

* 启动服务
* 停止服务
* 重启 VM

---

### ② 存储

自动识别外接磁盘。

显示：

* 磁盘名称
* 总容量
* 已使用容量
* 挂载状态
* 文件系统

第一版只支持：

**选择一个磁盘作为 NAS 数据盘。**

不做 RAID、不做存储池、不做快照。

---

### ③ Docker

MacNAS 自动管理：

**Lima VM + Docker Engine**

用户不需要安装 Docker Desktop。

界面提供：

* 容器列表
* 启动
* 停止
* 重启
* 查看日志

第一版暂时不提供高级 Docker 参数编辑。

---

### ④ 应用安装

第一版只提供 3 个预设应用：

* Jellyfin
* Syncthing
* FileBrowser

点击「安装」后：

1. 自动生成 Compose
2. 创建 AppData
3. 挂载数据目录
4. 启动容器
5. 显示访问地址

例如：

```text
Jellyfin

状态：运行中
地址：http://192.168.1.10:8096

[打开] [停止] [卸载]
```

不做完整应用商店。

---

### ⑤ NAS 文件共享

提供一个默认共享：

```text
/data
```

通过 SMB 暴露到局域网。

页面显示：

```text
共享名称：MacNAS
地址：smb://192.168.1.10/MacNAS
状态：运行中
```

第一版只支持：

* 一个 SMB 用户
* 一个共享目录
* 修改密码

不做复杂 ACL 权限。

---

## 3. 核心架构

```text
macOS
│
├── MacNAS Backend
│      └── Web UI
│
└── Lima VM
       │
       ├── Docker Engine
       │
       ├── Samba
       │
       └── Data
              │
              ├── media
              ├── files
              └── appdata
```

第一版优先采用：

**Lima managed disk / Linux ext4 数据盘**

避免数据库和 Docker AppData 直接长期运行在 VirtioFS 上。

如果物理磁盘 passthrough 暂时不稳定，则先使用：

```text
外接 SSD
└── MacNAS Linux Disk Image
        ↓
      Lima
        ↓
      ext4
```

跑通整个链路。

---

## 4. 页面结构

只做 4 个页面：

```text
首页
存储
Docker
应用
```

NAS SMB 设置放在「存储」页面，不单独增加页面。

---

## 5. 首次启动流程

```text
安装 MacNAS
    ↓
检测 Mac 环境
    ↓
创建 Lima VM
    ↓
安装/启动 Docker
    ↓
选择数据盘
    ↓
初始化数据目录
    ↓
启动 Samba
    ↓
进入首页
```

目标：

**用户不需要打开终端。**

---

## 6. 第一版不做

明确排除：

* RAID
* 多磁盘存储池
* ZFS
* 快照
* Time Machine
* 下载器
* 相册
* 用户组
* ACL
* 远程访问
* DDNS
* HTTPS
* 应用市场
* Docker 网络高级管理
* 镜像管理
* 在线文件管理器高级功能
* 自动更新

避免第一版失控。

---

## 7. 技术栈

建议：

```text
前端：React + Tailwind
后端：Go
VM：Lima
容器：Docker Engine
NAS：Samba
系统信息：macOS CLI / Go
应用部署：Docker Compose
```

MacNAS Backend 负责统一控制 Lima、Docker 和 Samba。

---

## 8. 核心验收标准

MVP 完成必须满足：

1. Mac 重启后 MacNAS 可以重新启动服务。
2. 不安装、不启动 Docker Desktop。
3. Web UI 可以看到 Docker 容器状态。
4. 可以一键安装 Jellyfin。
5. Jellyfin 可以读取 NAS 数据目录。
6. Windows / Mac 可以通过 SMB 访问数据。
7. Mac 睡眠并唤醒后服务能够恢复。
8. Lima VM 重启后数据不丢失。
9. Docker 容器重建后 AppData 不丢失。
10. 连续读写大文件时不会出现明显异常。

---

## 9. MVP 成功标准

第一版不是看功能数量。

只判断：

> **MacNAS 能否让一台 Mac mini 在不安装 Docker Desktop、不使用命令行的情况下，稳定承担 NAS + Docker 家庭服务器。**

如果这条链路稳定，再进入 v0.2。
