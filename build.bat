@echo off
setlocal

set "PROJECT_ROOT=%~dp0"
set "WEB_ROOT=%PROJECT_ROOT%web"
set "API_ROOT=%PROJECT_ROOT%api"
set "OUTPUT=%PROJECT_ROOT%easyssh.exe"

echo [1/2] Building React application...
pushd "%WEB_ROOT%"
call pnpm run build
if errorlevel 1 (
    popd
    echo Frontend build failed.
    exit /b 1
)
popd

echo [2/2] Building EasySSH executable...
pushd "%API_ROOT%"
go build -trimpath -ldflags="-s -w" -o "%OUTPUT%" ./cmd/server
if errorlevel 1 (
    popd
    echo Backend build failed.
    exit /b 1
)
popd

echo Built: %OUTPUT%
endlocal
