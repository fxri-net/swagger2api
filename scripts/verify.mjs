import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// 单一门禁真源：本仓库全部验收步骤由本脚本定义并按序执行，本地与三处 CI（GitHub check / windows、GitLab test）共用同一份清单。
// 目的：消除「各写一份步骤清单、彼此漂移」的结构性问题，使「本地自检通过、CI 才暴露」在清单层面不可能发生。
// 本文件不入 npm 包（files 白名单不含 scripts）
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const isWindows = process.platform === "win32"

const flags = new Set(process.argv.slice(2))
const skipDocs = flags.has("--skip-docs")

/**
 * 读取文本文件并去除首尾空白。
 * @param {string} file 绝对路径
 * @return {string} 去掉首尾空白后的内容
 */
function readTrimmed(file) {
  return readFileSync(file, "utf8").trim()
}

/**
 * 校验更新日志镜像页与根 CHANGELOG.md 是否同步。
 * @return {number} 进程退出码，0 表示同步
 */
function checkChangelogSync() {
  const page = join(root, "docs", "changelog.md")
  // 换行归一化：本地 core.autocrlf 检出与 CI 换行符不同，直接比对会把换行差异误报成「未同步」
  const normalize = (text) => text.replace(/\r\n/g, "\n")
  const before = normalize(readFileSync(page, "utf8"))

  const result = spawnSync(process.execPath, [join(root, "scripts", "sync-changelog-doc.mjs")], { cwd: root, stdio: "inherit" })
  if (result.status !== 0) return result.status ?? 1

  if (normalize(readFileSync(page, "utf8")) !== before) {
    console.error("✖ docs/changelog.md 与根 CHANGELOG.md 不同步，已重新生成，请连同本次变更一并提交")
    return 1
  }
  return 0
}

// 工具链版本仅作对照提示、不拦截：跨环境误判的常见疑点之一就是本地与 CI 的 node / pnpm 版本不同，先让人看见
function reportToolchain() {
  const { packageManager } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const expectedNode = readTrimmed(join(root, ".node-version"))
  const expectedPnpm = String(packageManager).replace(/^pnpm@/, "")
  const actualNode = process.version.replace(/^v/, "")
  const actualPnpm = (spawnSync("pnpm", ["--version"], { encoding: "utf8", shell: isWindows }).stdout ?? "").trim()

  console.log(`门禁校验：node ${actualNode}（仓库期望 ${expectedNode}）/ pnpm ${actualPnpm}（仓库期望 ${expectedPnpm}）`)
  if (actualNode !== expectedNode) {
    console.warn(`⚠️ node 版本与 .node-version 不一致：本地 ${actualNode}、CI ${expectedNode}，行为差异需由 windows job 对向兜底`)
  }
  if (actualPnpm !== expectedPnpm) {
    console.warn(`⚠️ pnpm 版本与 packageManager 不一致：本地 ${actualPnpm}、仓库声明 ${expectedPnpm}`)
  }
}

/**
 * 执行单条命令型步骤。
 * @param {{ command?: string, args: string[] }} step 步骤定义
 * @return {number} 进程退出码
 */
function runCommand(step) {
  const command = step.command ?? process.execPath
  // pnpm 在 Windows 上是 .cmd，需经 shell 调用；node 用 process.execPath 直呼，避免路径含空格时被 shell 拆断
  return spawnSync(command, step.args, { cwd: root, stdio: "inherit", shell: command === "pnpm" && isWindows }).status ?? 1
}

// 冒烟断言产物可被消费方导入：本仓库 src/cli.ts 无参数解析，直接执行 dist/cli.js 会进交互式选配置并挂住，不可作为冒烟手段
function smokeExports() {
  const code = `
    const mod = await import("./dist/index.js")
    if (typeof mod.generateApi !== "function") {
      console.error("dist/index.js 未按预期导出 generateApi")
      process.exit(1)
    }
    console.log("dist/index.js 导出 generateApi 正常")
  `
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], { cwd: root, stdio: "inherit" })
  return result.status ?? 1
}

// 步骤清单即门禁定义：顺序有依赖（build 先于导出冒烟），增删步骤只改这里
const steps = [
  { label: "安装依赖（frozen 锁文件）", command: "pnpm", args: ["install", "--frozen-lockfile"], fatal: true },
  { label: "类型检查", command: "pnpm", args: ["typecheck"] },
  // 走 lint 脚本而非直接调 eslint：检查范围（显式 glob）与冷缓存开关都收在 package.json 一处，避免两处漂移
  { label: "静态检查（冷缓存）", command: "pnpm", args: ["lint"] },
  { label: "构建", command: "pnpm", args: ["build"] },
  { label: "文档站构建（死链检查）", command: "pnpm", args: ["docs:build"], skip: skipDocs },
  { label: "包导出冒烟（dist/index.js）", run: smokeExports },
  { label: "更新日志同步核验", run: checkChangelogSync },
]

reportToolchain()

const failures = []
let executed = 0

for (const step of steps) {
  if (step.skip) continue
  console.log(`\n▶ ${step.label}`)
  executed += 1
  const status = step.run ? step.run() : runCommand(step)

  if (status === 0) continue
  failures.push(step.label)
  // 依赖装不上则后续步骤的失败都是噪音，直接中止；其余步骤全跑完，一次暴露全部问题
  if (step.fatal) break
}

if (failures.length > 0) {
  console.error(`\n✖ 门禁未通过：${failures.length} 步失败`)
  for (const label of failures) console.error(`  - ${label}`)
  process.exit(1)
}

console.log(`\n✔ 门禁全部通过（共 ${executed} 步）`)
