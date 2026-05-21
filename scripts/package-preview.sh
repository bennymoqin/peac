#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
CACHE_DIR="$ROOT_DIR/.cache/package-preview"
STAMP="${1:-$(date +%Y%m%d-%H%M)}"
PACKAGE_NAME="peac-preview-$STAMP"
PACKAGE_DIR="$DIST_DIR/$PACKAGE_NAME"
ZIP_PATH="$DIST_DIR/$PACKAGE_NAME.zip"
NODE_VERSION="${NODE_VERSION:-22.21.1}"
WINDOWS_NODE_ZIP="node-v${NODE_VERSION}-win-x64.zip"
WINDOWS_NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${WINDOWS_NODE_ZIP}"
WINDOWS_NODE_CACHE="$CACHE_DIR/$WINDOWS_NODE_ZIP"

if [ -e "$PACKAGE_DIR" ] || [ -e "$ZIP_PATH" ]; then
  echo "Package already exists: $PACKAGE_NAME"
  echo "Pass a different suffix, for example: scripts/package-preview.sh test-01"
  exit 1
fi

cd "$ROOT_DIR"

echo "Building production standalone bundle..."
npm run build

echo "Creating distribution folder..."
mkdir -p "$PACKAGE_DIR/.next"

cp -R "$ROOT_DIR/.next/standalone/." "$PACKAGE_DIR/"
cp -R "$ROOT_DIR/.next/static" "$PACKAGE_DIR/.next/static"

if [ -d "$ROOT_DIR/public" ]; then
  cp -R "$ROOT_DIR/public" "$PACKAGE_DIR/public"
fi

echo "Adding Windows portable Node.js runtime..."
mkdir -p "$CACHE_DIR"
if [ ! -f "$WINDOWS_NODE_CACHE" ]; then
  rm -f "$WINDOWS_NODE_CACHE.part"
  curl --retry 5 --retry-delay 2 --retry-all-errors -fL "$WINDOWS_NODE_URL" -o "$WINDOWS_NODE_CACHE.part"
  mv "$WINDOWS_NODE_CACHE.part" "$WINDOWS_NODE_CACHE"
fi

RUNTIME_TMP="$(mktemp -d)"
unzip -q "$WINDOWS_NODE_CACHE" -d "$RUNTIME_TMP"
mkdir -p "$PACKAGE_DIR/runtime/node"
cp "$RUNTIME_TMP/node-v${NODE_VERSION}-win-x64/node.exe" "$PACKAGE_DIR/runtime/node/node.exe"
cp "$RUNTIME_TMP/node-v${NODE_VERSION}-win-x64/LICENSE" "$PACKAGE_DIR/runtime/node/LICENSE"
cp "$RUNTIME_TMP/node-v${NODE_VERSION}-win-x64/README.md" "$PACKAGE_DIR/runtime/node/README.md"
rm -rf "$RUNTIME_TMP"

cat > "$PACKAGE_DIR/launcher.js" <<'SCRIPT'
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");

const appName = "适用于 1-6 年级的小学英语教育协作";
const host = "127.0.0.1";
const startPort = Number(process.env.PORT || 3000);

function findPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(findPort(port + 1)));
    server.once("listening", () => {
      server.close(() => resolve(port));
    });
    server.listen(port, host);
  });
}

function openBrowser(url) {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

(async () => {
  const port = await findPort(startPort);
  const url = `http://${host}:${port}`;
  const serverPath = path.join(__dirname, "server.js");

  console.log(`${appName}正在启动...`);
  console.log(`浏览器地址：${url}`);
  console.log("关闭本窗口即可停止服务。");

  const child = spawn(process.execPath, [serverPath], {
    cwd: __dirname,
    env: { ...process.env, HOSTNAME: host, PORT: String(port) },
    stdio: "inherit",
  });

  setTimeout(() => openBrowser(url), 1200);
  child.on("exit", (code) => process.exit(code ?? 0));
})();
SCRIPT

cat > "$PACKAGE_DIR/start-mac.command" <<'SCRIPT'
#!/bin/zsh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。请先安装 Node.js 20 或更高版本。"
  echo "下载地址：https://nodejs.org/"
  read -n 1 -s "?按任意键退出..."
  exit 1
fi

export HOSTNAME=127.0.0.1

node launcher.js
SCRIPT

cat > "$PACKAGE_DIR/start-windows.bat" <<'SCRIPT'
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
SCRIPT

cat > "$PACKAGE_DIR/Start_PEAC.bat" <<'SCRIPT'
@echo off
call "%~dp0start-windows.bat"
SCRIPT

cat > "$PACKAGE_DIR/双击启动.bat" <<'SCRIPT'
@echo off
call "%~dp0start-windows.bat"
SCRIPT

perl -0pi -e 's/\r?\n/\r\n/g' "$PACKAGE_DIR/start-windows.bat" "$PACKAGE_DIR/Start_PEAC.bat" "$PACKAGE_DIR/双击启动.bat"

cat > "$PACKAGE_DIR/README-试用说明.md" <<'SCRIPT'
# 适用于 1-6 年级的小学英语教育协作试用包

## 启动方式

Mac 用户双击：

```bash
start-mac.command
```

Windows 用户双击：

```bat
Start_PEAC.bat
```

如果希望看到中文文件名，也可以双击 `双击启动.bat`，两者作用相同。

启动后浏览器会打开：

```text
http://127.0.0.1:3000
```

## 使用前准备

本试用包不包含开发者的 API Key。首次使用时，请在页面的模型配置里填写自己的 DeepSeek、Kimi 或 Gemini API Key。页面默认不保存 API Key，刷新或重新打开后需要重新填写；如需清空当前页面中已填写的密钥，可点击“清除密钥”。

Windows 版已经内置便携 Node.js 运行时，正常情况下不需要老师额外安装开发环境。如果双击启动脚本提示缺少 `runtime\node\node.exe`，说明压缩包没有完整解压，请重新解压后再运行。

Mac 版仍需要电脑已安装 Node.js 20 或更高版本。如果双击启动脚本提示未检测到 Node.js，请先安装：

```text
https://nodejs.org/
```

## 数据保存位置

上传的资料和模型配置保存在当前浏览器本机存储中。更换浏览器或清理浏览器数据后，需要重新上传资料和填写配置。

## 停止服务

关闭启动脚本打开的终端窗口即可停止服务。
SCRIPT

chmod +x "$PACKAGE_DIR/start-mac.command"

echo "Creating zip archive..."
cd "$DIST_DIR"
zip -qr "$ZIP_PATH" "$PACKAGE_NAME"

echo "Done:"
echo "$PACKAGE_DIR"
echo "$ZIP_PATH"

