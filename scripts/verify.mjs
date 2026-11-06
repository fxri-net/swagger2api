import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

// 单一门禁真源：本仓库全部验收步骤由本脚本定义并按序执行，本地与三处 CI（GitHub check / windows、GitLab test）共用同一份清单。
// 目的：消除「各写一份步骤清单、彼此漂移」的结构性问题，使「本地自检通过、CI 才暴露」在清单层面不可能发生。
// 本文件不入 npm 包（files 白名单不含 scripts）
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const isWindows = process.platform === "win32"

const flags = new Set(process.argv.slice(2))
const skipDocs = flags.has("--skip-docs")
const skipLinks = flags.has("--skip-links")
const skipChangeset = flags.has("--skip-changeset")
// --full 强制全量：忽略本地改动面与安装缓存判断，等价于 CI 口径
const full = flags.has("--full")
// CI 环境一律全量：本地裁剪只服务于开发效率，不能让 CI 漏检安装与死链
const ciValue = process.env.CI ?? ""
const isCI = ciValue !== "" && ciValue !== "0" && ciValue.toLowerCase() !== "false"

// 文档站构建触发面：站点输入含文档正文与内链，根 CHANGELOG 会同步进 docs，依赖清单决定构建工具版本
const DOC_TOUCH_PREFIXES = ["docs/"]
const DOC_TOUCH_FILES = new Set(["CHANGELOG.md", "README.md", "package.json", "pnpm-lock.yaml"])

/**
 * 读取文本文件并去除首尾空白。
 * @param {string} file 绝对路径
 * @return {string} 去掉首尾空白后的内容
 */
function readTrimmed(file) {
  return readFileSync(file, "utf8").trim()
}

/**
 * 校验更新日志镜像页与根 CHANGELOG.md 是否同步；未安装全局 toolkit 时打印跳过。
 * @return {number} 进程退出码，0 表示同步
 */
function checkChangelogSync() {
  const result = spawnSync(process.execPath, [join(root, "scripts", "check-changelog-doc.mjs")], { cwd: root, stdio: "inherit" })
  return result.status ?? 1
}

/**
 * git 只读调用：成功返回输出（可能为空串），失败返回 null。
 * @param {string[]} args git 参数
 * @return {string | null} 输出或 null
 */
function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

/**
 * 变更基准：显式 ref > GitHub 事件载荷 > GitLab MR diff 基准 > 目标分支 merge-base > 变更前提交 > 本地 HEAD~1。
 * @return {string | null} 基准提交
 */
function resolveBaseline() {
  const explicit = process.env.CHANGESET_BASE_REF
  if (explicit) return git(["merge-base", explicit, "HEAD"]) ?? git(["rev-parse", explicit])
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath && existsSync(eventPath)) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8"))
      const before = event?.before
      const sha = event?.pull_request?.base?.sha || (before && !/^0+$/.test(before) ? before : "")
      if (sha && git(["cat-file", "-e", `${sha}^{commit}`]) !== null) return sha
    } catch {
      // 事件载荷不可读时继续走其余基准
    }
  }
  const mrBase = process.env.CI_MERGE_REQUEST_DIFF_BASE_SHA
  if (mrBase && git(["cat-file", "-e", `${mrBase}^{commit}`]) !== null) return mrBase
  const baseRef = process.env.GITHUB_BASE_REF || process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME
  if (baseRef) {
    for (const ref of [`origin/${baseRef}`, baseRef]) {
      const merged = git(["merge-base", ref, "HEAD"])
      if (merged) return merged
    }
  }
  const before = process.env.CI_COMMIT_BEFORE_SHA
  if (before && !/^0+$/.test(before) && git(["cat-file", "-e", `${before}^{commit}`]) !== null) return before
  return git(["rev-parse", "HEAD~1"])
}

/**
 * 递归收集 docs 下的 Markdown。
 * @param {string} dir 目录
 * @return {string[]} Markdown 文件
 */
function collectMarkdown(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectMarkdown(full))
    else if (entry.name.endsWith(".md")) files.push(full)
  }
  return files
}

/**
 * 文档相对链接可达性：跳过外链、锚点与站点根路径；无扩展名时补 .md / index.md 再判。
 * @return {number} 退出码
 */
function checkDocLinks() {
  if (skipLinks) return 0
  const docsRoot = join(root, "docs")
  if (!existsSync(docsRoot)) return 0
  const issues = []
  for (const file of collectMarkdown(docsRoot)) {
    const content = readFileSync(file, "utf8")
    for (const matched of content.matchAll(/\]\(([^)]+)\)/g)) {
      const raw = (matched[1] ?? "").trim()
      if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("/")) continue
      const target = raw.split("#")[0]
      if (!target) continue
      const base = resolve(dirname(file), target)
      const candidates = [base, `${base}.md`, join(base, "index.md")]
      if (!candidates.some((path) => existsSync(path))) issues.push(`${relative(root, file).split(sep).join("/")}: 链接目标不存在：${raw}`)
    }
  }
  if (issues.length === 0) return 0
  console.error(`\n✖ 文档链接检查未通过：${issues.length} 项`)
  for (const issue of issues) console.error(`  - ${issue}`)
  return 1
}

/**
 * 文档站主题一致性：全局 toolkit 可用时执行 docs theme --check，未安装时打印跳过（远程 CI 不依赖该工具）。
 * @return {number} 退出码
 */
function checkDocsTheme() {
  const probe = spawnSync("toolkit", ["docs", "theme", "--help"], { encoding: "utf8", shell: isWindows })
  if (probe.status !== 0) {
    console.log("跳过文档站主题检查（未检测到 toolkit docs theme）")
    return 0
  }
  const result = spawnSync("toolkit", ["docs", "theme", "--check"], { stdio: "inherit", shell: isWindows })
  return result.status ?? 1
}

/**
 * 变更集一致性：触及 src/ 或手写 docs 的改动须新增变更集；docs/changelog.md 为生成物，不触发。
 * @return {number} 退出码
 */
function checkChangeset() {
  if (skipChangeset) return 0
  const baseline = resolveBaseline()
  if (!baseline) {
    console.log("变更集校验：跳过（无 git 基准）")
    return 0
  }
  const changed = (git(["diff", "--name-only", baseline]) ?? "")
    .split("\n")
    .filter(Boolean)
    .map((file) => file.split(sep).join("/"))
  const triggers = changed.some((file) => (file.startsWith("src/") || file.startsWith("docs/")) && file !== "docs/changelog.md")
  if (!triggers) return 0
  const baselineFiles = new Set(
    (git(["ls-tree", "--name-only", baseline, ".changeset/"]) ?? "")
      .split("\n")
      .filter(Boolean)
      .map((file) => file.split("/").pop()),
  )
  const current = existsSync(join(root, ".changeset"))
    ? readdirSync(join(root, ".changeset")).filter((name) => name.endsWith(".md") && name !== "README.md")
    : []
  // 发版提交会在同一次推送内消费掉变更集，净差异看不到它，故区间内新增过即算数
  const addedInRange = (git(["log", "--diff-filter=A", "--name-only", "--pretty=format:", `${baseline}..HEAD`, "--", ".changeset/"]) ?? "")
    .split("\n")
    .map((file) => file.trim())
    .filter((file) => file.endsWith(".md") && file.split("/").pop() !== "README.md")
  if (addedInRange.length > 0 || current.some((name) => !baselineFiles.has(name))) return 0
  console.error("\n✖ 变更集检查未通过：本次改动触及 src/ 或 docs/，须新增变更集")
  return 1
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

/**
 * git 只读调用：成功返回行数组，失败返回 null（调用方按「可能触及」保守处理）。
 * @param {string[]} args git 参数
 * @return {string[] | null} 输出行或 null
 */
function gitLines(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  if (result.status !== 0) return null
  return (result.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/**
 * 本次是否需要构建文档站：拿不到改动面时保守执行。
 * @return {boolean} true 表示执行 docs:build
 */
function needDocsBuild() {
  if (isCI || full) return true
  const tracked = gitLines(["diff", "--name-only", "HEAD"])
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"])
  if (tracked === null || untracked === null) return true
  for (const file of [...tracked, ...untracked]) {
    if (DOC_TOUCH_FILES.has(file)) return true
    if (DOC_TOUCH_PREFIXES.some((prefix) => file.startsWith(prefix))) return true
  }
  return false
}

/**
 * 依赖是否需要重装：lockfile 比已安装快照新，或安装目录缺失。
 * @return {boolean} true 表示执行 pnpm install
 */
function needInstall() {
  if (isCI || full) return true
  try {
    return statSync(join(root, "pnpm-lock.yaml")).mtimeMs > statSync(join(root, "node_modules", ".pnpm", "lock.yaml")).mtimeMs
  } catch {
    return true
  }
}

const installNeeded = needInstall()
const docsNeeded = needDocsBuild()

// 步骤清单即门禁定义：顺序有依赖（build 先于导出冒烟），增删步骤只改这里
const steps = [
  { label: "安装依赖（frozen 锁文件）", command: "pnpm", args: ["install", "--frozen-lockfile"], fatal: true, skip: installNeeded ? "" : "lockfile 未变化" },
  { label: "类型检查", command: "pnpm", args: ["typecheck"] },
  { label: "单元测试", command: "pnpm", args: ["test"] },
  // 走 lint 脚本而非直接调 eslint：检查范围（显式 glob）与冷缓存开关都收在 package.json 一处，避免两处漂移
  { label: "静态检查（冷缓存）", command: "pnpm", args: ["lint"] },
  { label: "构建", command: "pnpm", args: ["build"] },
  { label: "文档站构建（死链检查）", command: "pnpm", args: ["docs:build"], skip: skipDocs ? "--skip-docs" : docsNeeded ? "" : "未触及 docs/、README.md、依赖清单" },
  { label: "包导出冒烟（dist/index.js）", run: smokeExports },
  { label: "更新日志同步核验", run: checkChangelogSync },
  { label: "文档站主题一致性", run: checkDocsTheme },
  { label: "文档站导航规范（分类 / 命名 / 顶栏）", args: ["scripts/check-docs-nav.mjs"] },
  { label: "文档链接可达性", run: checkDocLinks },
  { label: "变更集一致性", run: checkChangeset },
]

reportToolchain()

const failures = []
let executed = 0

for (const step of steps) {
  if (step.skip) {
    console.log(`\n⊘ ${step.label}（${step.skip}，跳过）`)
    continue
  }
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
