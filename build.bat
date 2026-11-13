@echo off
setlocal

set "PROJECT_ROOT=%~dp0"
set "WEB_ROOT=%PROJECT_ROOT%web"
set "API_ROOT=%PROJECT_ROOT%api"
set "OUTPUT=%PROJECT_ROOT%easyssh.exe"

echo [1/2] Building React application...
pushd "%WEB_ROOT%"
where bun >nul 2>nul
if errorlevel 1 (
    call pnpm run build
) else (
    bun run --bun node_modules/typescript/bin/tsc -b
    if errorlevel 1 (
        popd
        exit /b 1
    )
    bun run --bun node_modules/vite/bin/vite.js build
)
if errorlevel 1 (
    popd
    echo Frontend build failed.
    exit /b 1
)
popd

echo [2/2] Building EasySSH executable...
pushd "%API_ROOT%"
go build -trimpath -ldflags="-s -w -H windowsgui" -o "%OUTPUT%" ./cmd/desktop
if errorlevel 1 (
    popd
    echo Backend build failed.
    exit /b 1
)
popd

echo Built: %OUTPUT%
endlocal
