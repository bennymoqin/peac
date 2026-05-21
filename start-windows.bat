@echo off
chcp 65001 >nul
set "APP_DIR=%~dp0"
pushd "%APP_DIR%"

set "NODE_EXE=%APP_DIR%runtime\node\node.exe"
set "LAUNCHER=%APP_DIR%launcher.js"

if not exist "%LAUNCHER%" (
  echo 未找到启动文件：%LAUNCHER%
  echo 请确认压缩包已经完整解压后再运行。
  pause
  exit /b 1
)

if not exist "%NODE_EXE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo 未检测到可用的 Node.js 运行时。
    echo 请确认 runtime\node\node.exe 存在，或安装 Node.js 20 及以上版本。
    echo 下载地址：https://nodejs.org/
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

"%NODE_EXE%" "%LAUNCHER%"
if errorlevel 1 (
  echo.
  echo 启动失败。请把本窗口中的错误信息发给维护人员。
  echo 下载地址：https://nodejs.org/
  pause
  exit /b 1
)
