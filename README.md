# EasySSH

基于 Go、React 和 Wails v3 的本地 SSH、SFTP 与数据库 GUI 工具。

## Windows 桌面版

双击 `easyssh.exe` 打开应用窗口，无需浏览器，也无需单独启动后端。

- HTTP API、终端 WebSocket 和前端静态资源由同一进程提供。
- 桌面版监听 `127.0.0.1:0`，系统自动分配空闲端口，不使用固定的 8080，不对局域网开放。
- 每次启动生成独立会话凭证，HTTP、SSE 和 WebSocket 使用同一会话。
- 主机和数据库连接在当前窗口打开，通过页面返回按钮回到管理界面。
- 关闭最后一个窗口后退出程序，停止监控和 HTTP 服务，并取消终端会话。

数据默认保存在**可执行文件旁边的 `data` 目录**，与启动时的工作目录无关。现有 `easyssh.db` 和 `master.key` 可直接沿用；搬动程序时请一起保留整个 `data` 目录。该目录需要写入权限。

主题与 SQL 标签页草稿保存到 `desktop-preferences.json`，不会因随机端口变化而重置。原浏览器中的主题和未保存草稿不会自动导入。启动日志位于 `data/desktop.log`。

Windows 需要 Microsoft Edge WebView2 Runtime。构建需要 Go 1.26+，以及 Node.js + pnpm 或 Bun。

## 构建

首次构建先在 `web` 目录执行 `pnpm install`，然后在项目根目录运行：

```bat
build.bat
```

脚本构建 React 界面，生成不带控制台窗口的 `easyssh.exe`。如果安装了 Bun，会优先使用 Bun 构建前端，不依赖 Node 版本管理器的活动版本。首次构建 Go 会下载 Wails 依赖，无需额外安装 Wails CLI。

Linux/macOS 可运行 `sh build.sh`，但需要先满足 Wails 对应平台的原生构建依赖；这些平台尚未在本项目中验证。

## 浏览器开发模式

保留原有 HTTP 服务入口。分别运行：

```powershell
cd api
go run ./cmd/server
```

```powershell
cd web
pnpm dev
```

访问 `http://localhost:5173`，Vite 将 `/api` 和 WebSocket 请求代理到 `localhost:8080`。这里的 8080 仅用于原有开发模式；桌面版不使用它。

桌面版从项目根目录构建后运行 `easyssh.exe`。不建议直接 `go run ./cmd/desktop`，因为其临时可执行文件目录也会成为默认数据目录。

现有 `EASYSSH_DATABASE_DRIVER`、`EASYSSH_DATABASE_DSN` 和 `EASYSSH_DATA_DIR` 配置继续生效；`EASYSSH_ADDRESS` 仅影响浏览器服务入口，桌面版始终使用回环随机端口。
