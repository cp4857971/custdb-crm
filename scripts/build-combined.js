// 构建脚本：构建前端 → 组装后端 + 前端产物 → 复制进应用包 → fnpack 打包
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.join(__dirname, "..");
const frontendDir = path.join(root, "frontend");
const backendDir = path.join(root, "backend");
const outDir = path.join(root, "dist");
const packDir = path.join(root, "custdb");
const packServerDir = path.join(packDir, "app", "server");

function run(command, cwd = process.cwd()) {
  execSync(command, { stdio: "inherit", cwd });
}

function emptyDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

console.log("==> 构建前端");
run("npm run build", frontendDir);

console.log("==> 组装后端产物");
emptyDir(outDir);
fs.cpSync(backendDir, outDir, {
  recursive: true,
  filter: (src) => !src.endsWith("node_modules") && !src.endsWith("data") && !src.endsWith("public")
});
fs.mkdirSync(path.join(outDir, "public"), { recursive: true });
fs.cpSync(path.join(frontendDir, "dist"), path.join(outDir, "public"), { recursive: true });

const backendPkg = JSON.parse(fs.readFileSync(path.join(backendDir, "package.json"), "utf8"));
fs.writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify(
    {
      name: "custdb-combined",
      version: backendPkg.version || "1.0.0",
      private: true,
      main: "server.js",
      type: "commonjs",
      scripts: { start: "node server.js" },
      dependencies: backendPkg.dependencies || {}
    },
    null,
    2
  )
);

console.log("==> 安装后端运行时依赖（仅生产依赖）");
run("npm install --omit=dev", outDir);

console.log("==> 复制到应用包目录 custdb/app/server");
emptyDir(packServerDir);
fs.cpSync(outDir, packServerDir, { recursive: true });

// 剥离打包产物中的符号链接（npm 生成的 .bin 常指向构建机绝对路径，
// 会导致 NAS 安装时“解压app.tgz失败”），运行时不需要这些 CLI 入口。
console.log("==> 清理绝对路径符号链接（node_modules/.bin）");
const binDir = path.join(packServerDir, "node_modules", ".bin");
if (fs.existsSync(binDir)) fs.rmSync(binDir, { recursive: true, force: true });
(function removeAbsSymlinks(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) {
      const target = fs.readlinkSync(p);
      if (path.isAbsolute(target)) {
        fs.rmSync(p, { force: true });
      }
      continue;
    }
    if (st.isDirectory()) removeAbsSymlinks(p);
  }
})(packServerDir);
console.log("   完成（已移除 " + (fs.existsSync(binDir) ? "" : "node_modules/.bin，") + "全部绝对路径符号链接）");

try {
  console.log("==> fnpack 打包");
  run("fnpack build --directory " + packDir);
  console.log("构建完成，生成 custdb.fpk");
} catch (e) {
  console.warn("[提示] 本地未安装 fnpack，已完成应用包目录组装（custdb/app/server）。");
  console.warn("        请安装飞牛官方 fnpack 后执行：fnpack build --directory custdb");
}
