const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");

const appName = "PEAC 小学英语智能备课教研协作中心";
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

function ping(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.setTimeout(1000, () => request.destroy());
    request.once("error", () => resolve(false));
  });
}

async function waitForServer(url, child, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.killed) return false;
    if (await ping(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
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
  child.on("exit", (code) => process.exit(code ?? 0));

  if (await waitForServer(url, child)) {
    openBrowser(url);
  } else if (!child.killed && child.exitCode === null) {
    console.log("服务启动较慢，请稍后手动打开：", url);
  }
})();
