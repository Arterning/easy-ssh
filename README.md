# EasySSH

EasySSH 将 React 前端、Go API、SSH 终端和运维 Agent 打包为一个 Windows 可执行文件。

## 开发

分别启动 API 和 Vite 开发服务器：

```powershell
cd api
go run ./cmd/server
```

```powershell
cd web
pnpm dev
```

访问 `http://localhost:5173`。Vite 会将 `/api` 和 WebSocket 请求代理到 `localhost:8080`。

## 构建单文件版本

在 EasySSH 根目录运行：

Windows：

```bat
build.bat
```

Linux/macOS：

```sh
chmod +x build.sh
./build.sh
```

Windows 生成 `easyssh.exe`，Linux/macOS 生成 `easyssh`。运行后访问 `http://localhost:8080`：

```powershell
.\easyssh.exe
```

程序会在当前工作目录的 `data` 文件夹中创建 SQLite 数据库和凭据加密主密钥。
