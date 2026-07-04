const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const resolvedProjectRoot = path.resolve(projectRoot);
const projectHash = crypto
  .createHash("sha1")
  .update(resolvedProjectRoot.toLowerCase())
  .digest("hex")
  .slice(0, 8);
const projectSlug =
  path
    .basename(resolvedProjectRoot)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32) || "the-house";
const instanceId = process.env.HOUSE_INSTANCE_ID || `${projectSlug}-${projectHash}`;
const userDataName = process.env.HOUSE_USER_DATA_NAME || `The House Dev - ${instanceId}`;
const vitePort = Number(process.env.HOUSE_VITE_PORT || process.env.VITE_PORT || (5100 + (parseInt(projectHash.slice(0, 4), 16) % 700)));
const walkiePort = Number(process.env.HOUSE_WALKIE_PORT || (8700 + (parseInt(projectHash.slice(4, 8), 16) % 800)));
const viteUrl = `http://127.0.0.1:${vitePort}`;

const env = {
  ...process.env,
  DISABLE_TELEMETRY: "1",
  DISABLE_ERROR_REPORTING: "1",
  HOUSE_INSTANCE_ID: instanceId,
  HOUSE_USER_DATA_NAME: userDataName,
  HOUSE_VITE_PORT: String(vitePort),
  HOUSE_WALKIE_PORT: String(walkiePort),
  VITE_DEV_SERVER_URL: viteUrl
};

const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const electronBin = path.join(projectRoot, "node_modules", "electron", "cli.js");

const waitForUrl = (url, timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(check, 300);
      });
      request.setTimeout(1000, () => request.destroy());
    };
    check();
  });

const children = new Set();
let shuttingDown = false;

const startChild = (command, args) => {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    shell: false
  });
  children.add(child);
  child.on("exit", (code) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      shutdown(code || 1);
    }
  });
  return child;
};

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill();
  }
  setTimeout(() => process.exit(code), 100);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`[house-dev] instance ${instanceId}`);
console.log(`[house-dev] userData ${userDataName}`);
console.log(`[house-dev] vite ${viteUrl}`);
console.log(`[house-dev] walkie http://0.0.0.0:${walkiePort}`);

startChild(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"]);

waitForUrl(viteUrl)
  .then(() => {
    if (!shuttingDown) startChild(process.execPath, [electronBin, "."]);
  })
  .catch((error) => {
    console.error(`[house-dev] ${error.message}`);
    shutdown(1);
  });
