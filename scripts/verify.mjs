import { execFileSync, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

// 单一门禁真源：本仓库全部验收步骤由本脚本定义并按序执行，本地与三处 CI（GitHub check / windows、GitLab test）共用同一份清单。
// 目的：消除「各写一份步骤清单、彼此漂移」的结构性问题，使「本地自检通过、CI 才暴露」在清单层面不可能发生。
// 本文件不入 npm 包（files 白名单不含 scripts）
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const isWindows = process.platform === "win32"

/** 生成横幅：与 CLI 的 GENERATED_BANNER 同源，用于判定产物归属 */
const GENERATED_BANNER = "THIS FILE WAS GENERATED VIA @FXRI/SWAGGER2API, DO NOT EDIT"
/** 中文横幅：默认输出语言，识别时与英文锚点同等有效 */
const GENERATED_BANNER_ZH = "本文件由 @fxri/swagger2api 生成，请勿手改"
/** 中英锚点 */
const BANNER_ANCHORS = [GENERATED_BANNER, GENERATED_BANNER_ZH]

/**
 * 写出新 schema 的单文档项目配置：共享段进 base，输入输出进 docs。
 * @param {string} file 配置文件路径
 * @param {{source: unknown, output: unknown, base?: Record<string, unknown>, id?: string, doc?: Record<string, unknown>}} options 配置片段
 * @return {string} 配置文件路径
 */
function writeProjectConfig(file, options) {
  const { source, output, base = {}, id = "main", doc = {} } = options
  writeFileSync(file, JSON.stringify({ base, docs: [{ id, source, output, ...doc }] }, null, 2))
  return file
}

/**
 * 按文件头 1KB 判定生成物，与 CLI 的 isGeneratedFile 保持同一口径（当前中英锚点）。
 * @param {string} file 文件绝对路径
 * @return {boolean} 是否为生成物
 */
function hasBanner(file) {
  const fd = openSync(file, "r")
  try {
    const buffer = Buffer.alloc(1024)
    const read = readSync(fd, buffer, 0, 1024, 0)
    const head = buffer.subarray(0, read).toString("utf8")
    return BANNER_ANCHORS.some((anchor) => head.includes(anchor))
  } finally {
    closeSync(fd)
  }
}

/**
 * 断言目录内所有代码文件都带生成横幅，手写文件之外不应出现无横幅产物。
 * @param {string} dir 产物目录
 * @param {string[]} issues 问题收集数组
 * @return {void}
 */
function assertAllGenerated(dir, issues) {
  for (const file of collectFiles(dir)) {
    if (!/\.(?:ts|js)$/.test(file)) continue
    if (!hasBanner(join(dir, file))) issues.push(`生成物缺少横幅：${file}`)
  }
}

/**
 * 断言目录内生成物的横幅块文本一致，且横幅不含上游工具名。
 * @param {string} dir 产物目录
 * @param {string[]} issues 问题收集数组
 * @return {void}
 */
function assertUniformBanner(dir, issues) {
  const blocks = new Set()
  for (const file of collectFiles(dir)) {
    if (!/\.(?:ts|js)$/.test(file)) continue
    const head = readFileSync(join(dir, file), "utf8").slice(0, 1024)
    const block = (head.match(/\/\*[\s\S]*?\*\//g) ?? []).find((item) => BANNER_ANCHORS.some((anchor) => item.includes(anchor)))
    if (!block) {
      issues.push(`生成物缺少横幅块：${file}`)
      continue
    }
    blocks.add(block)
  }
  if (blocks.size > 1) issues.push(`同目录横幅块不一致：${blocks.size} 种`)
  for (const block of blocks) if (block.includes("swagger-typescript-api")) issues.push("横幅仍包含上游工具名 swagger-typescript-api")
}

const flags = new Set(process.argv.slice(2))
const skipDocs = flags.has("--skip-docs")
const skipLinks = flags.has("--skip-links")
const skipChangeset = flags.has("--skip-changeset")
// 运行时回归模式：供 node18 job 使用，构建与文档类步骤由 node20 job 覆盖，这里只验运行时可达与产物一致
const runtimeOnly = flags.has("--runtime-only")
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
 * 文档站主题一致性：全局 toolkit 可用时执行 docs theme check，未安装时打印跳过（远程 CI 不依赖该工具）。
 * @return {number} 退出码
 */
function checkDocsTheme() {
  const probe = spawnCli("toolkit", ["docs", "theme", "--help"], { encoding: "utf8" })
  if (probe.status !== 0) {
    console.log("跳过文档站主题检查（未检测到 toolkit docs theme）")
    return 0
  }
  const result = spawnCli("toolkit", ["docs", "theme", "check"], { stdio: "inherit" })
  return result.status ?? 1
}

/**
 * 文档站导航规范：全局 toolkit 可用时执行 docs nav check，未安装时打印跳过（远程 CI 不依赖该工具）。
 * @return {number} 退出码
 */
function checkDocsNav() {
  const probe = spawnCli("toolkit", ["docs", "nav", "--help"], { encoding: "utf8" })
  if (probe.status !== 0) {
    console.log("跳过文档站导航检查（未检测到 toolkit docs nav）")
    return 0
  }
  return spawnCli("toolkit", ["docs", "nav", "check"], { stdio: "inherit" }).status ?? 1
}

/**
 * 文档站产物：全局 toolkit 可用时执行 docs dist check，未安装时打印跳过（远程 CI 不依赖该工具）。
 * @return {number} 退出码
 */
function checkDocsDist() {
  const probe = spawnCli("toolkit", ["docs", "dist", "--help"], { encoding: "utf8" })
  if (probe.status !== 0) {
    console.log("跳过文档站产物检查（未检测到 toolkit docs dist）")
    return 0
  }
  return spawnCli("toolkit", ["docs", "dist", "check"], { stdio: "inherit" }).status ?? 1
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
  // 期望版本可由环境变量声明：node18 回归 job 不读 .node-version，避免按开发口径误报
  const expectedNode = process.env.EXPECTED_NODE || readTrimmed(join(root, ".node-version"))
  const expectedPnpm = String(packageManager).replace(/^pnpm@/, "")
  const actualNode = process.version.replace(/^v/, "")
  const actualPnpm = (spawnCli("pnpm", ["--version"], { encoding: "utf8" }).stdout ?? "").trim()

  console.log(`门禁校验：node ${actualNode}（仓库期望 ${expectedNode}）/ pnpm ${actualPnpm}（仓库期望 ${expectedPnpm}）`)
  if (actualNode !== expectedNode) {
    console.warn(`⚠️ node 版本与 .node-version 不一致：本地 ${actualNode}、CI ${expectedNode}，行为差异需由 windows job 对向兜底`)
  }
  if (actualPnpm !== expectedPnpm) {
    console.warn(`⚠️ pnpm 版本与 packageManager 不一致：本地 ${actualPnpm}、仓库声明 ${expectedPnpm}`)
  }
}

/**
 * 运行外部命令：Windows 下 pnpm / toolkit 是 .cmd，必须经 shell 执行。
 * node 24 起「shell + args 数组」会触发 DEP0190，故 Windows 改为单条命令字符串传入。
 * ⚠️ 仅用于参数全为内部常量的调用；含用户输入的调用必须改用 cmd.exe 参数数组方式。
 * @param {string} command 可执行文件名
 * @param {string[]} args 参数
 * @param {object} options spawnSync 选项（无需再传 shell）
 * @return {object} 子进程结果
 */
function spawnCli(command, args, options = {}) {
  if (isWindows) return spawnSync([command, ...args].join(" "), { ...options, shell: true })
  return spawnSync(command, args, options)
}

/**
 * 执行单条命令型步骤。
 * @param {{ command?: string, args: string[] }} step 步骤定义
 * @return {number} 进程退出码
 */
function runCommand(step) {
  const command = step.command ?? process.execPath
  // pnpm 在 Windows 上是 .cmd，需经 shell 调用；node 用 process.execPath 直呼，避免路径含空格时被 shell 拆断
  if (command === "pnpm") return spawnCli("pnpm", step.args, { cwd: root, stdio: "inherit" }).status ?? 1
  return spawnSync(command, step.args, { cwd: root, stdio: "inherit" }).status ?? 1
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
 * 技能规范校验：全局 toolkit 达到下限时调用 skills lint；缺失或过旧时降级为本仓硬断言并提示升级。
 * 规范真源在 @fxri/toolkit，本仓不复制命名、篇幅与版本规则。
 * @return {number} 退出码
 */
function checkSkillsLint() {
  const minVersion = "1.17.6"
  const probe = spawnCli("toolkit", ["skills", "lint", "--help"], { encoding: "utf8" })
  const versionRun = spawnCli("toolkit", ["--version"], { encoding: "utf8" })
  const version = versionRun.status === 0 ? (versionRun.stdout ?? "").trim() : ""
  if (probe.status !== 0 || !version) {
    console.warn(`⚠️ 跳过技能规范校验：未检测到全局 toolkit（需要 @fxri/toolkit >= ${minVersion}）；安装或升级后重跑`)
    return 0
  }
  if (!versionAtLeast(version, minVersion)) {
    console.warn(`⚠️ 跳过技能规范校验：全局 toolkit ${version} 低于 ${minVersion}；升级后重跑`)
    return 0
  }
  const base = resolveBaseline() ?? "HEAD"
  return spawnCli("toolkit", ["skills", "lint", "skills", "--base", base], { cwd: root, stdio: "inherit" }).status ?? 1
}

/**
 * 版本下限比较：只取前三段数字，预发布后缀按同号正式版处理。
 * @param {string} actual 实际版本
 * @param {string} expected 期望下限
 * @return {boolean} 实际版本不低于期望
 */
function versionAtLeast(actual, expected) {
  const parse = (value) => (/^(\d+)\.(\d+)\.(\d+)/.exec(value) ?? []).slice(1, 4).map(Number)
  const a = parse(actual)
  const b = parse(expected)
  if (a.length < 3 || b.length < 3) return false
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index]
  }
  return true
}

/**
 * 技能打包与定位硬断言：files 含 skills、skill 命令可定位、入口可读、npm 包带上技能目录。
 * 不复制 toolkit 的规范规则，只保证「打包带得上、入口找得到」。
 * @return {number} 退出码
 */
function checkSkillPackage() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 技能打包与定位：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const issues = []
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  if (!Array.isArray(pkg.files) || !pkg.files.includes("skills")) issues.push("package.json files 未包含 skills")

  const jsonRun = spawnSync(process.execPath, [cli, "skill", "--json"], { cwd: root, encoding: "utf8" })
  if (jsonRun.status !== 0) {
    issues.push("skill --json 执行失败")
  } else {
    try {
      const info = JSON.parse(jsonRun.stdout)
      if (!info.entry || !existsSync(info.entry)) issues.push("skill --json 的 entry 不可读")
      if (!info.referencesDir || !existsSync(info.referencesDir)) issues.push("skill --json 的 referencesDir 不可读")
      if (!info.version) issues.push("skill --json 缺少技能版本")
    } catch {
      issues.push("skill --json 输出不可解析")
    }
  }

  const printRun = spawnSync(process.execPath, [cli, "skill", "--print"], { cwd: root, encoding: "utf8" })
  if (printRun.status !== 0) issues.push("skill --print 执行失败")
  else if (!/^---[\s\S]*?name:\s*fxri-swagger2api/m.test(printRun.stdout ?? "") || !(printRun.stdout ?? "").includes("本技能版本")) {
    issues.push("skill --print 未输出完整技能入口")
  }

  // npm 打包清单：只读预演，不生成 tgz
  const pack = spawnCli("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" })
  if (pack.status !== 0) {
    issues.push("npm pack --dry-run 执行失败")
  } else {
    try {
      const parsed = JSON.parse(pack.stdout)
      const files = (Array.isArray(parsed) ? parsed[0]?.files : parsed.files) ?? []
      if (!files.some((item) => item.path === "skills/fxri-swagger2api/SKILL.md")) issues.push("npm 打包未包含 skills/fxri-swagger2api/SKILL.md")
    } catch {
      issues.push("npm pack --dry-run 输出不可解析")
    }
  }

  if (issues.length === 0) return 0
  console.error(`\n✖ 技能打包与定位未通过：${issues.length} 项`)
  for (const issue of issues) console.error(`  - ${issue}`)
  return 1
}

/**
 * 递归收集目录下的文件，返回相对路径数组。
 * @param {string} dir 目录
 * @param {string} [base] 相对基准目录（递归时保持一致，避免子目录路径丢失前缀）
 * @return {string[]} 相对路径（统一为 / 分隔）
 */
function collectFiles(dir, base = dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(full, base))
    else files.push(relative(base, full).split(sep).join("/"))
  }
  return files
}

/**
 * 夹具产物一致性：用夹具生成一次 API，与 fixtures/expected 逐文件比对。
 * 覆盖「真实文档生成 + 模板渲染 + 格式化」整条运行时链路，各运行时作业都会跑。
 * @return {number} 退出码
 */
function checkGeneratedOutput() {
  const fixtures = join(root, "fixtures")
  const expected = join(fixtures, "expected")
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(expected)) {
    console.log("跳过生成产物一致性（未提供 fixtures/expected）")
    return 0
  }
  if (!existsSync(cli)) {
    console.error("✖ 生成产物一致性：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-fixtures-"))
  try {
    const config = writeProjectConfig(join(out, "swagger2api.json"), {
      source: join(fixtures, "swagger.json"),
      output: out,
      base: { output: { name: "index" } }
    })
    // 与 pnpm api 一致的主力参数组合；配置写到临时目录，避免回写夹具
    const result = spawnSync(process.execPath, [cli, "-c", config, "--axios", "--responses", "-rpi", "0", "-err"], { cwd: root, stdio: "inherit" })
    if (result.status !== 0) return result.status ?? 1

    const issues = []
    const expectedFiles = collectFiles(expected)
    const actualFiles = collectFiles(out).filter((file) => file !== "swagger2api.json")
    for (const file of expectedFiles) {
      if (!actualFiles.includes(file)) {
        issues.push(`缺少产物：${file}`)
        continue
      }
      // 行尾归一后再比对，避免 Windows 检出配置造成假差异
      const want = readFileSync(join(expected, file), "utf8").replace(/\r\n/g, "\n")
      const got = readFileSync(join(out, file), "utf8").replace(/\r\n/g, "\n")
      if (want !== got) issues.push(`产物不一致：${file}`)
    }
    for (const file of actualFiles) {
      if (!expectedFiles.includes(file)) issues.push(`多余产物：${file}`)
    }
    if (issues.length === 0) return 0
    console.error(`\n✖ 生成产物一致性未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 安全夹具：注入用例的产物必须能被 TS 解析，私网外部引用必须被拒绝并以非 0 退出。
 * @return {number} 退出码
 */
async function checkSecurityFixtures() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 安全夹具：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const securityDir = join(root, "fixtures", "security")
  const ts = await import("typescript")

  /**
   * 用指定夹具跑一次生成
   * @param fixture 夹具文件名
   * @param outDir 输出目录
   * @return {{ status: number, output: string }}
   */
  const runFixture = (fixture, outDir) => {
    const config = writeProjectConfig(join(outDir, "swagger2api.json"), {
      source: join(securityDir, fixture),
      output: outDir,
      base: { output: { name: "index" } }
    })
    const result = spawnSync(process.execPath, [cli, "-c", config, "--axios", "--responses", "-rpi", "0", "-err"], { cwd: root, encoding: "utf8" })
    return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
  }

  // 注入用例：生成成功且产物语法合法
  const injectionOut = mkdtempSync(join(tmpdir(), "s2a-security-"))
  try {
    const injection = runFixture("injection.json", injectionOut)
    if (injection.status !== 0) {
      console.error("✖ 安全夹具：注入用例未按预期生成成功")
      console.error(injection.output)
      return 1
    }
    const file = join(injectionOut, "index.ts")
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
    if (source.parseDiagnostics.length > 0) {
      console.error(`✖ 安全夹具：注入用例产物无法解析（${source.parseDiagnostics.length} 条语法错误）`)
      return 1
    }
  } finally {
    rmSync(injectionOut, { recursive: true, force: true })
  }

  // 私网引用用例：必须被拒绝且退出码非 0
  const privateOut = mkdtempSync(join(tmpdir(), "s2a-security-"))
  try {
    const privateRef = runFixture("private-ref.json", privateOut)
    if (privateRef.status === 0) {
      console.error("✖ 安全夹具：私网外部引用未被拒绝")
      return 1
    }
    if (!privateRef.output.includes("拒绝拉取")) {
      console.error("✖ 安全夹具：私网外部引用缺少明确的拒绝信息")
      return 1
    }
  } finally {
    rmSync(privateOut, { recursive: true, force: true })
  }
  return 0
}

/**
 * 分组产物一致性：axios 与 fetch 各生成一次分组产物，断言聚合入口存在、模块不串组、产物可解析。
 * @return {number} 退出码
 */
async function checkGroupedOutput() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 分组产物：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const ts = await import("typescript")
  const clients = [
    { name: "axios", args: ["--axios"] },
    { name: "fetch", args: [] }
  ]
  for (const client of clients) {
    const out = mkdtempSync(join(tmpdir(), "s2a-grouped-"))
    const api = join(out, "api")
    try {
      const config = writeProjectConfig(join(out, "swagger2api.json"), {
        source: join(root, "fixtures", "swagger.json"),
        output: api,
        base: { output: { name: "index" } }
      })
      const result = spawnSync(process.execPath, [cli, "-c", config, ...client.args, "--modular", "--module-name-index", "0"], { cwd: root, encoding: "utf8" })
      if (result.status !== 0) {
        console.error(`✖ 分组产物（${client.name}）：生成失败`)
        console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`)
        return 1
      }
      if (!existsSync(join(api, "index.ts"))) {
        console.error(`✖ 分组产物（${client.name}）：缺少聚合入口 index.ts`)
        return 1
      }
      const appModule = readFileSync(join(api, "App.ts"), "utf8")
      if (!appModule.includes("appItemsGet") || appModule.includes("homeDetailPost")) {
        console.error(`✖ 分组产物（${client.name}）：模块文件串组或缺少本组接口`)
        return 1
      }
      for (const file of collectFiles(api).filter((name) => name.endsWith(".ts"))) {
        const source = ts.createSourceFile(file, readFileSync(join(api, file), "utf8"), ts.ScriptTarget.Latest, true)
        if (source.parseDiagnostics.length > 0) {
          console.error(`✖ 分组产物（${client.name}）：${file} 无法解析`)
          return 1
        }
      }
      // 横幅语言与共享请求器注入方式：默认中文横幅，共享请求器不可枚举
      const aggregateSource = readFileSync(join(api, "index.ts"), "utf8")
      if (!aggregateSource.includes(GENERATED_BANNER_ZH)) {
        console.error(`✖ 分组产物（${client.name}）：聚合入口未使用默认中文横幅`)
        return 1
      }
      if (!appModule.includes('Object.defineProperty(this, "http", { value: http, enumerable: false })') || appModule.includes("this.http = http")) {
        console.error(`✖ 分组产物（${client.name}）：共享请求器仍可枚举，深合并会成环`)
        return 1
      }
      // 导入口径：值导入只能引用运行时值（类 / 枚举 / 常量），纯类型必须走 import type
      const typesDir = join(api, "types")
      const enums = new Set()
      if (existsSync(typesDir)) {
        for (const file of collectFiles(typesDir).filter((name) => name.endsWith(".ts"))) {
          const source = ts.createSourceFile(file, readFileSync(join(typesDir, file), "utf8"), ts.ScriptTarget.Latest, true)
          for (const statement of source.statements) {
            if (ts.isEnumDeclaration(statement)) enums.add(statement.name.text)
          }
        }
      }
      const clientFile = join(api, "client.ts")
      const clientValues = new Set()
      if (existsSync(clientFile)) {
        const source = ts.createSourceFile("client.ts", readFileSync(clientFile, "utf8"), ts.ScriptTarget.Latest, true)
        for (const statement of source.statements) {
          if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isFunctionDeclaration(statement)) {
            if (statement.name) clientValues.add(statement.name.text)
          } else if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
              if (ts.isIdentifier(declaration.name)) clientValues.add(declaration.name.text)
            }
          }
        }
      }
      const reserved = new Set(["index.ts", "client.ts", "route-types.ts"])
      for (const file of collectFiles(api).filter((name) => name.endsWith(".ts") && !name.startsWith("types/") && !reserved.has(name))) {
        const source = ts.createSourceFile(file, readFileSync(join(api, file), "utf8"), ts.ScriptTarget.Latest, true)
        for (const statement of source.statements) {
          if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
          const specifier = statement.moduleSpecifier.text
          const allowed = specifier === "./client" ? clientValues : specifier.startsWith("./types") ? enums : null
          if (!allowed) continue
          const clause = statement.importClause
          if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue
          const wrong = clause.namedBindings.elements.map((element) => element.name.text).filter((name) => !allowed.has(name))
          if (wrong.length > 0) {
            console.error(`✖ 分组产物（${client.name}）：${file} 以值导入引用纯类型 ${wrong.join("、")}`)
            return 1
          }
        }
      }
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }
  return 0
}

/**
 * 分组命名边界：非 ASCII、路径字符、全半角重名、数字开头、保留名与纯符号组名，
 * 断言产物文件名合法、命名表与产物一致、JSDoc 保留原始标签。走 rc 配置驱动，覆盖分组装配全链路。
 * @return {number} 退出码
 */
async function checkGroupedNaming() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 分组命名边界：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const ts = await import("typescript")
  const out = mkdtempSync(join(tmpdir(), "s2a-grouped-naming-"))
  const api = join(out, "api")
  try {
    // 生成器要求输出目录存在，rc 从工作目录向上查找
    writeProjectConfig(join(out, "swagger2api.json"), {
      source: join(root, "fixtures", "grouping-edge.json"),
      output: api,
      base: {
        output: { mode: "grouped", name: "index" },
        client: "axios",
        grouping: { strategy: ["tag"], names: { "★☆": "symbolGroup" } }
      }
    })
    const result = spawnSync(process.execPath, [cli], { cwd: out, encoding: "utf8" })
    if (result.status !== 0) {
      console.error("✖ 分组命名边界：生成失败")
      console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`)
      return 1
    }
    const expected = ["SymbolGroup.ts", "G20孵化器.ts", "Con2.ts", "Index2.ts", "企业团队管理.ts", "企业团队管理2.ts", "用户管理.ts", "管理端其他功能510红名单管理.ts"]
    const files = readdirSync(api)
    for (const file of expected) {
      if (!files.includes(file)) {
        console.error(`✖ 分组命名边界：缺少预期模块文件 ${file}`)
        return 1
      }
    }
    // JSDoc 保留原始标签，模块名只用于文件与类名
    const userModule = readFileSync(join(api, "用户管理.ts"), "utf8")
    if (!userModule.includes("@tags 用户管理")) {
      console.error("✖ 分组命名边界：JSDoc 未保留原始标签")
      return 1
    }
    const aggregate = readFileSync(join(api, "index.ts"), "utf8")
    for (const property of ["symbolGroup", "g20孵化器", "con2", "index2"]) {
      if (!aggregate.includes(`${property} = new `)) {
        console.error(`✖ 分组命名边界：聚合入口缺少 ${property}`)
        return 1
      }
    }
    for (const file of collectFiles(api).filter((name) => name.endsWith(".ts"))) {
      const source = ts.createSourceFile(file, readFileSync(join(api, file), "utf8"), ts.ScriptTarget.Latest, true)
      if (source.parseDiagnostics.length > 0) {
        console.error(`✖ 分组命名边界：${file} 无法解析`)
        return 1
      }
    }
    return 0
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 分组命名兼容：collapse 合并、聚合成员保留名与 replace-tags 参数守卫。
 * 统一走 `--dry-run --json`，只校验命名表，不落盘。
 * @return {number} 退出码
 */
async function checkGroupingCompat() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 分组命名兼容：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-naming-compat-"))
  try {
    const fixture = join(root, "fixtures", "grouping-collapse.json")
    const writeRc = (name, grouping) =>
      writeProjectConfig(join(out, name), {
        source: fixture,
        output: join(out, "api"),
        base: { output: { name: "index", mode: "grouped" }, grouping }
      })
    const run = (config, extra = []) =>
      spawnSync(process.execPath, [cli, "-c", config, "--dry-run", "--json", ...extra], { cwd: out, encoding: "utf8" })
    // 分组日志先于 JSON 输出，从首个 { 起截取结构化报表；多文档模式取首个文档的报表
    const readReport = (result) => {
      const payload = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")))
      return payload.docs ? payload.docs[0].report : payload
    }

    const collapsed = run(writeRc("collapse-on.json", { strategy: ["path"], pathDepth: 0, collapse: true }))
    if (collapsed.status !== 0) {
      console.error("✖ 分组命名兼容：collapse 开启时报表失败")
      console.error(`${collapsed.stdout ?? ""}${collapsed.stderr ?? ""}`)
      return 1
    }
    const on = readReport(collapsed)
    const onRaws = on.groups.map((group) => group.raw)
    const onOpt = on.groups.find((group) => group.raw === "opt")
    const onInstance = on.groups.find((group) => group.raw === "instance")
    if (onRaws.join(",") !== "instance,opt" || onRaws.includes("opt_") || !onOpt || onOpt.property !== "opt") {
      console.error(`✖ 分组命名兼容：collapse 未按预期合并（${onRaws.join(",")}）`)
      return 1
    }
    if (!onInstance || onInstance.property !== "instance2") {
      console.error("✖ 分组命名兼容：聚合成员保留名未追加后缀")
      return 1
    }

    const loose = run(writeRc("collapse-off.json", { strategy: ["path"], pathDepth: 0 }))
    if (loose.status !== 0) {
      console.error("✖ 分组命名兼容：collapse 关闭时报表失败")
      console.error(`${loose.stdout ?? ""}${loose.stderr ?? ""}`)
      return 1
    }
    const offProperties = readReport(loose)
      .groups.map((group) => group.property)
      .sort()
    if (offProperties.join(",") !== "instance2,opt,opt2") {
      console.error(`✖ 分组命名兼容：默认行为与预期不符（${offProperties.join(",")}）`)
      return 1
    }

    // 单个值的 replace-tags 必须告警并忽略，而不是用空串清空标签
    const guarded = run(writeRc("tags.json", { strategy: ["path"], pathDepth: 0 }), ["-rt", "[a-z_]+(.+)"])
    if (guarded.status !== 0 || !`${guarded.stderr ?? ""}`.includes("已忽略 --replace-tags")) {
      console.error("✖ 分组命名兼容：replace-tags 缺值时未给出忽略告警")
      return 1
    }
    return 0
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 保留名护栏：分组驼峰聚合成员、单文件模式命名空间都不得覆盖底座成员。
 * @return {number} 退出码
 */
async function checkReservedNaming() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 保留名护栏：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-reserved-"))
  try {
    const write = (name, mode, fixture) =>
      writeProjectConfig(join(out, name), {
        source: join(root, "fixtures", fixture),
        output: join(out, name.replace(/\.json$/, "")),
        base: { output: { name: "index", mode } }
      })
    const run = (config) => spawnSync(process.execPath, [cli, "-c", config], { cwd: out, encoding: "utf8" })
    const issues = []

    const grouped = run(write("grouped.json", "grouped", "grouping-reserved.json"))
    if (grouped.status !== 0) {
      console.error("✖ 保留名护栏：分组生成失败")
      console.error(`${grouped.stdout ?? ""}${grouped.stderr ?? ""}`)
      return 1
    }
    const groupedIndex = readFileSync(join(out, "grouped", "index.ts"), "utf8")
    if (!groupedIndex.includes("setSecurityData2 = new")) issues.push("分组：驼峰保留名未追加后缀")
    if (/^ {2}setSecurityData = new/m.test(groupedIndex)) issues.push("分组：setSecurityData 仍覆盖底座成员")

    const single = run(write("single.json", "single", "single-reserved.json"))
    if (single.status !== 0) {
      console.error("✖ 保留名护栏：单文件生成失败")
      console.error(`${single.stdout ?? ""}${single.stderr ?? ""}`)
      return 1
    }
    const singleIndex = readFileSync(join(out, "single", "index.ts"), "utf8")
    for (const name of ["request2", "setSecurityData2"]) {
      if (!singleIndex.includes(`${name} = {`)) issues.push(`单文件：命名空间 ${name} 未生成`)
    }
    for (const name of ["request", "setSecurityData"]) {
      if (new RegExp(`^ {2}${name} = \\{`, "m").test(singleIndex)) issues.push(`单文件：${name} 仍覆盖底座成员`)
    }

    if (issues.length) {
      issues.forEach((issue) => console.error(`✖ 保留名护栏：${issue}`))
      return 1
    }
    return 0
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 产物清理与可复现：按横幅清理不碰手写文件、手写文件护栏终止、连续两次生成字节一致。
 * @return {number} 退出码
 */
async function checkGroupedPrune() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 产物清理与可复现：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-prune-"))
  try {
    const base = join(out, "base")
    const config = writeProjectConfig(join(out, "swagger2api.json"), {
      source: join(root, "fixtures", "swagger.json"),
      output: base,
      base: {
        output: { name: "index", mode: "grouped", prune: true },
        client: "axios",
        types: { responses: true },
        grouping: { strategy: ["path"], pathDepth: 0 }
      }
    })
    const generate = () => spawnSync(process.execPath, [cli, "-c", config], { cwd: out, encoding: "utf8" })
    const issues = []

    const first = generate()
    if (first.status !== 0) {
      console.error("✖ 产物清理与可复现：首次生成失败")
      console.error(`${first.stdout ?? ""}${first.stderr ?? ""}`)
      return 1
    }
    for (const file of ["index.ts", "App.ts", "Home.ts", "Api.ts", "client.ts", "types/index.ts"]) {
      if (!existsSync(join(base, file))) issues.push(`缺少产物：${file}`)
    }
    if (!collectFiles(base).some((file) => file.startsWith("types/") && file.endsWith(".ts") && file !== "types/index.ts")) {
      issues.push("缺少拆分后的契约文件")
    }
    // 归属判据：整目录产物（含本工具补写的聚合入口与契约）都带生成横幅
    assertAllGenerated(base, issues)
    assertUniformBanner(base, issues)

    // 模拟手写适配文件与上一轮遗留模块：横幅只写在生成物里，手写文件不带
    writeFileSync(join(base, "axios.ts"), "// 手写适配\n")
    writeFileSync(join(base, "Old.ts"), `/* ## ${GENERATED_BANNER} ## */\nexport {}\n`)

    const second = generate()
    if (second.status !== 0) {
      console.error("✖ 产物清理与可复现：第二次生成失败")
      console.error(`${second.stdout ?? ""}${second.stderr ?? ""}`)
      return 1
    }
    if (existsSync(join(base, "Old.ts"))) issues.push("已消失的旧模块未被清理")
    if (!existsSync(join(base, "axios.ts")) || !readFileSync(join(base, "axios.ts"), "utf8").includes("手写适配")) {
      issues.push("手写文件被清理或改写")
    }

    // 可复现：同一配置连续生成，产物集合与内容完全一致（含 types/ 子目录）
    const snapshot = () =>
      Object.fromEntries(
        collectFiles(base)
          .sort()
          .map((name) => [name, readFileSync(join(base, name), "utf8")]),
      )
    const before = snapshot()
    const third = generate()
    if (third.status !== 0) {
      console.error("✖ 产物清理与可复现：第三次生成失败")
      console.error(`${third.stdout ?? ""}${third.stderr ?? ""}`)
      return 1
    }
    const after = snapshot()
    if (Object.keys(before).join(",") !== Object.keys(after).join(",")) issues.push("连续两次生成的产物集合不一致")
    else for (const name of Object.keys(before)) if (before[name] !== after[name]) issues.push(`产物不稳定：${name}`)

    // 手写文件护栏：不含横幅的同名文件必须终止生成且保持原样
    writeFileSync(join(base, "Home.ts"), "// 手写模块\n")
    const blocked = generate()
    if (blocked.status === 0) issues.push("手写文件冲突未终止生成")
    if (!`${blocked.stdout ?? ""}${blocked.stderr ?? ""}`.includes("不含生成横幅")) issues.push("手写文件冲突缺少提示")
    if (readFileSync(join(base, "Home.ts"), "utf8") !== "// 手写模块\n") issues.push("手写文件被覆盖")

    // 关闭 prune：只报告多余产物，不删除
    writeFileSync(join(base, "Home.ts"), `/* ## ${GENERATED_BANNER} ## */\nexport class Home {}\n`)
    writeFileSync(join(base, "Orphan.ts"), `/* ## ${GENERATED_BANNER} ## */\nexport {}\n`)
    const kept = spawnSync(process.execPath, [cli, "-c", config, "--prune-output", "false"], { cwd: out, encoding: "utf8" })
    if (kept.status !== 0) issues.push("prune 关闭时生成失败")
    else {
      if (!existsSync(join(base, "Orphan.ts"))) issues.push("prune 关闭时仍删除了多余产物")
      if (!`${kept.stdout ?? ""}${kept.stderr ?? ""}`.includes("产物多余")) issues.push("prune 关闭时未报告多余产物")
    }

    if (issues.length === 0) return 0
    return fail(...issues)
  } finally {
    rmSync(out, { recursive: true, force: true })
  }

  /**
   * 输出问题清单
   * @param {...string} issues 问题
   * @return {number} 退出码
   */
  function fail(...issues) {
    console.error(`\n✖ 产物清理与可复现未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  }
}

/**
 * 非交互保护：缺配置、init、grouping 在管道 stdio 下立即以退出码 2 结束并给出等价非交互命令。
 * @return {number} 退出码
 */
async function checkNonInteractive() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 非交互保护：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-noninteractive-"))
  try {
    const issues = []
    // 隔离用户主目录，避免本机全局配置影响「缺配置」判定
    const home = join(out, "home")
    mkdirSync(home, { recursive: true })
    const run = (args) =>
      spawnSync(process.execPath, [cli, ...args], {
        cwd: out,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, HOME: home, USERPROFILE: home }
      })

    // 空目录裸跑：缺配置直接报错，不进入交互
    const boot = run([])
    if (boot.status !== 2) issues.push(`缺配置未以退出码 2 结束（实际 ${boot.status}）`)
    if (!`${boot.stderr ?? ""}`.includes("未找到 swagger2api.json")) issues.push("缺配置缺少明确提示")
    if (!`${boot.stderr ?? ""}`.includes("--config")) issues.push("缺配置未给出非交互命令")

    // init 非交互：给出 --from-script 等价命令
    const init = run(["init"])
    if (init.status !== 2) issues.push(`init 非终端未以退出码 2 结束（实际 ${init.status}）`)
    if (!`${init.stderr ?? ""}`.includes("--from-script")) issues.push("init 未给出迁移命令")

    // grouping 非交互：报表后报错，退出码 2
    writeProjectConfig(join(out, "swagger2api.json"), {
      source: join(root, "fixtures", "swagger.json"),
      output: join(out, "api"),
      base: { output: { name: "index" } }
    })
    const grouping = run(["grouping", "--target", "main"])
    if (grouping.status !== 2) issues.push(`grouping 非终端未以退出码 2 结束（实际 ${grouping.status}）`)
    if (!`${grouping.stderr ?? ""}`.includes("grouping 需要交互式终端")) issues.push("grouping 缺少非交互提示")

    // 显式 --config：非交互环境仍可生成
    const config = writeProjectConfig(join(out, "api-config.json"), {
      source: join(root, "fixtures", "swagger.json"),
      output: join(out, "gen"),
      base: { output: { name: "index" } }
    })
    const generate = run(["--config", config, "--no-interactive"])
    if (generate.status !== 0) {
      issues.push("显式 --config 在非交互环境未生成成功")
      console.error(`${generate.stdout ?? ""}${generate.stderr ?? ""}`)
    }

    if (issues.length === 0) return 0
    console.error(`\n✖ 非交互保护未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 文档选择：单文档直接执行，多文档默认必须显式 --all / --target，非交互给出稳定错误码。
 * @return {number} 退出码
 */
async function checkDocSelection() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 文档选择：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-selection-"))
  const issues = []
  const fixture = join(root, "fixtures", "swagger.json")
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: out, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
  const stderrOf = (result) => String(result.stderr ?? "")
  try {
    const single = writeProjectConfig(join(out, "single.json"), {
      source: fixture,
      output: "./single-api",
      base: { output: { name: "index" } }
    })
    if (run(["-c", single]).status !== 0) issues.push("单文档未直接生成")

    const multi = join(out, "multi.json")
    writeFileSync(
      multi,
      JSON.stringify(
        {
          base: { output: { name: "index" } },
          docs: [
            { id: "a", source: fixture, output: "./multi/a" },
            { id: "b", source: fixture, output: "./multi/b" }
          ]
        },
        null,
        2
      )
    )

    // 多文档非交互：必须显式选择
    const required = run(["-c", multi])
    if (required.status !== 2) issues.push(`多文档非交互未以退出码 2 结束（实际 ${required.status}）`)
    if (!stderrOf(required).includes("--target") || !stderrOf(required).includes("--all")) issues.push("多文档非交互缺少 --target / --all 提示")

    const requiredJson = run(["-c", multi, "--json"])
    if (requiredJson.status !== 2) issues.push("多文档 --json 未以退出码 2 结束")
    else {
      try {
        const payload = JSON.parse(requiredJson.stdout)
        if (payload.errorCode !== "E_DOC_SELECTION_REQUIRED") issues.push("多文档 --json 缺少稳定错误码")
        if (!payload.actions?.length) issues.push("多文档 --json 缺少 actions")
      } catch (error) {
        issues.push(`多文档 --json 无法解析：${error.message}`)
      }
    }

    // --all 全量；--target 子集不碰其他文档
    if (run(["-c", multi, "--all"]).status !== 0) issues.push("--all 生成失败")
    if (!existsSync(join(out, "multi", "a", "index.ts")) || !existsSync(join(out, "multi", "b", "index.ts"))) issues.push("--all 未生成全部文档")
    rmSync(join(out, "multi", "b"), { recursive: true, force: true })
    if (run(["-c", multi, "--target", "a"]).status !== 0) issues.push("--target 子集生成失败")
    if (!existsSync(join(out, "multi", "a", "index.ts"))) issues.push("--target 未生成指定文档")
    if (existsSync(join(out, "multi", "b"))) issues.push("--target 子集误生成了其他文档")

    if (run(["-c", multi, "--target", "nope"]).status !== 2) issues.push("未知文档未以退出码 2 结束")
    const conflict = run(["-c", multi, "--target", "a", "--all"])
    if (conflict.status !== 2 || !stderrOf(conflict).includes("不能同时使用")) issues.push("--target 与 --all 冲突未按用法错误结束")

    const removed = run(["-c", single, "--quick"])
    if (removed.status !== 2 || !stderrOf(removed).includes("已移除")) issues.push("--quick 未按已移除参数报错")

    if (issues.length === 0) return 0
    console.error(`\n✖ 文档选择未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 能力清单漂移门禁：命令注册表与 --help、技能能力地图、docs 能力总览、README 命令表保持一致。
 * @return {number} 退出码
 */
async function checkCapabilityDrift() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 能力清单漂移：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const result = spawnSync(process.execPath, [cli, "capabilities", "--json"], { cwd: root, encoding: "utf8" })
  if (result.status !== 0) {
    console.error("✖ 能力清单漂移：capabilities --json 执行失败")
    console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`)
    return 1
  }
  let payload
  try {
    payload = JSON.parse(result.stdout)
  } catch (error) {
    console.error(`✖ 能力清单漂移：capabilities --json 无法解析（${error.message}）`)
    return 1
  }
  const issues = []
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  if (payload.schemaVersion !== 1) issues.push("capabilities 缺少 schemaVersion")
  if (payload.toolVersion !== pkg.version) issues.push("capabilities 的 toolVersion 与 package.json 不一致")
  const commands = payload.commands ?? []
  if (!commands.length) issues.push("capabilities 未输出命令清单")
  const ids = new Set()
  for (const item of commands) {
    if (!item.id || ids.has(item.id)) issues.push(`能力 ID 缺失或重复：${item.id}`)
    ids.add(item.id)
    if (!String(item.name ?? "").startsWith("swagger2api")) issues.push(`命令名格式错误：${item.id}`)
    if (!item.purpose) issues.push(`命令缺少用途：${item.id}`)
    if (typeof item.readOnly !== "boolean" || typeof item.destructive !== "boolean") issues.push(`命令缺少只读 / 破坏性标记：${item.id}`)
    if (!item.examples?.length) issues.push(`命令缺少示例：${item.id}`)
    for (const example of item.examples ?? []) {
      if (!example.startsWith("swagger2api")) issues.push(`示例不是完整命令：${item.id} → ${example}`)
    }
    // 破坏性标记必须与示例里的 --yes 一致，避免 AI 误判操作风险
    if ((item.examples ?? []).some((example) => example.includes("--yes")) !== Boolean(item.destructive)) {
      issues.push(`破坏性标记与示例不一致：${item.id}`)
    }
  }
  // 四视图一致：--help 文本、技能能力地图、docs 能力总览、README 命令表
  const helpText = spawnSync(process.execPath, [cli, "--help"], { cwd: root, encoding: "utf8" }).stdout ?? ""
  const skill = readFileSync(join(root, "skills", "fxri-swagger2api", "SKILL.md"), "utf8")
  const docs = readFileSync(join(root, "docs", "capabilities.md"), "utf8")
  const readme = readFileSync(join(root, "README.md"), "utf8")
  for (const item of commands) {
    const token = item.name.split(" ")[1] ?? ""
    if (token && !helpText.includes(token)) issues.push(`--help 缺少命令入口：${item.name}`)
    if (!skill.includes(`\`${item.id}\``)) issues.push(`技能能力地图缺少：${item.id}`)
    if (!docs.includes(`\`${item.id}\``)) issues.push(`docs 能力总览缺少：${item.id}`)
    if (!readme.includes(item.name)) issues.push(`README 命令表缺少：${item.name}`)
  }
  // 技能参考索引与 references 目录一一对应
  const refDir = join(root, "skills", "fxri-swagger2api", "references")
  const actual = readdirSync(refDir).filter((name) => name.endsWith(".md")).sort()
  const listed = (payload.skill?.references ?? []).map((item) => item.file).sort()
  if (actual.join(",") !== listed.join(",")) issues.push(`技能参考索引与 references 目录不一致：${listed.join(",")} vs ${actual.join(",")}`)
  for (const item of listed) if (!existsSync(join(refDir, item))) issues.push(`技能参考文件不存在：${item}`)
  if (!(payload.configKeys ?? []).length) issues.push("capabilities 缺少配置项")
  if ((payload.exitCodes ?? []).map((item) => item.code).join(",") !== "0,1,2") issues.push("capabilities 退出码不是 0/1/2")
  const skillVersion = /^[ \t]+version:[ \t]*"?([^"\r\n]+?)"?[ \t]*$/m.exec(skill)?.[1] ?? ""
  if (payload.skill?.version !== skillVersion) issues.push("capabilities 技能版本与 SKILL.md 不一致")
  if (issues.length === 0) return 0
  console.error(`\n✖ 能力清单漂移未通过：${issues.length} 项`)
  for (const issue of issues) console.error(`  - ${issue}`)
  return 1
}

/**
 * 拉取超时与版本：慢响应以退出码 1 结束并给出可重试提示，--timeout 覆盖生效，--version 输出纯文本版本。
 * @return {number} 退出码
 */
async function checkTimeoutAndVersion() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 拉取超时与版本：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-timeout-"))
  const { createServer } = await import("node:http")
  /** 故意不响应，模拟源站卡住 */
  const server = createServer(() => {})
  const sockets = new Set()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  try {
    const issues = []
    // --version：纯文本一行，与 package.json 一致
    const version = spawnSync(process.execPath, [cli, "--version"], { cwd: out, encoding: "utf8" })
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    if (version.status !== 0) issues.push("--version 未以退出码 0 结束")
    if (version.stdout.trim() !== pkg.version) issues.push(`--version 输出与 package.json 不一致（${version.stdout.trim()}）`)

    const config = writeProjectConfig(join(out, "swagger2api.json"), {
      source: { url: `http://127.0.0.1:${port}/spec.json`, timeout: 300 },
      output: join(out, "api"),
      base: { output: { name: "index" } }
    })
    const slow = spawnSync(process.execPath, [cli, "-c", config], { cwd: out, encoding: "utf8" })
    if (slow.status !== 1) issues.push(`超时未以退出码 1 结束（实际 ${slow.status}）`)
    const slowOutput = `${slow.stdout ?? ""}${slow.stderr ?? ""}`
    if (!slowOutput.includes("超时")) issues.push("超时缺少可读提示")
    if (!slowOutput.includes("可重试") || !slowOutput.includes("本地快照")) issues.push("超时提示缺少可执行的下一步")

    // --timeout 覆盖配置值
    const override = spawnSync(process.execPath, [cli, "-c", config, "--timeout", "150"], { cwd: out, encoding: "utf8" })
    if (override.status !== 1) issues.push("--timeout 覆盖后未以退出码 1 结束")
    if (!`${override.stdout ?? ""}${override.stderr ?? ""}`.includes("> 150 毫秒")) issues.push("--timeout 覆盖未生效")

    if (issues.length === 0) return 0
    console.error(`\n✖ 拉取超时与版本未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    sockets.forEach((socket) => socket.destroy())
    server.close()
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 废弃目录清理命令：默认只列不删、--yes 才删、手写文件保留、高风险目录拒绝。
 * @return {number} 退出码
 */
async function checkPruneCommand() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 清理命令：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-prune-cmd-"))
  try {
    const api = join(out, "api")
    mkdirSync(join(api, "types"), { recursive: true })
    writeFileSync(join(api, "App.ts"), `/* ## ${GENERATED_BANNER} ## */\nexport {}\n`)
    writeFileSync(join(api, "types", "index.ts"), `/* ## ${GENERATED_BANNER} ## */\nexport {}\n`)
    writeFileSync(join(api, "hand.ts"), "// 手写适配\n")
    writeFileSync(join(api, ".gitignore"), "node_modules\n")
    const issues = []
    const run = (args) => spawnSync(process.execPath, [cli, "prune", ...args], { cwd: out, encoding: "utf8" })

    const preview = run(["--dir", api, "--json"])
    if (preview.status !== 0) issues.push(`prune 预览失败：${preview.stderr ?? ""}`)
    else {
      try {
        const summary = JSON.parse(preview.stdout)
        if (summary.schemaVersion !== 1 || !summary.toolVersion) issues.push("prune --json 缺少契约字段")
        if (summary.dryRun !== true) issues.push("prune 预览未标记 dryRun")
        if (!Array.isArray(summary.files) || summary.files.length !== 2) issues.push("prune 预览未列出全部生成物")
        if (summary.files?.includes("hand.ts")) issues.push("prune 把手写文件当作生成物")
      } catch (error) {
        issues.push(`prune --json 无法解析：${error.message}`)
      }
    }
    if (!existsSync(join(api, "App.ts"))) issues.push("prune 预览删除了文件")

    const applied = run(["--dir", api, "--yes"])
    if (applied.status !== 0) issues.push("prune --yes 执行失败")
    if (existsSync(join(api, "App.ts")) || existsSync(join(api, "types", "index.ts"))) issues.push("prune --yes 未删除生成物")
    if (!existsSync(join(api, "hand.ts")) || !existsSync(join(api, ".gitignore"))) issues.push("prune 删除了非生成物")

    if (run([]).status !== 2) issues.push("prune 缺少 --dir 未以退出码 2 结束")
    if (run(["--dir", join(out, "missing")]).status !== 2) issues.push("prune 未拒绝不存在的目录")
    if (run(["--dir", out]).status !== 2) issues.push("prune 未拒绝当前目录")
    const repo = join(out, "repo")
    mkdirSync(join(repo, ".git"), { recursive: true })
    if (run(["--dir", repo]).status !== 2) issues.push("prune 未拒绝仓库根")
    const configDir = join(out, "cfg")
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, "swagger2api.json"), "{}")
    if (run(["--dir", configDir]).status !== 2) issues.push("prune 未拒绝配置目录")

    if (issues.length === 0) return 0
    console.error(`\n✖ 清理命令未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 分组产物对外面：聚合入口导出面、模块声明类型链、共享客户端与类型推导。
 * 以「仓内桶文件 + declare.ts 增强」的真实形态断言 AxiosParse 推导不退化为 unknown。
 * @return {number} 退出码
 */
async function checkGroupedContract() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 分组产物对外面：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  // 放在 node_modules/.cache 下，便于 tsc 向上解析本仓的 axios 类型
  const cacheRoot = join(root, "node_modules", ".cache")
  mkdirSync(cacheRoot, { recursive: true })
  const out = mkdtempSync(join(cacheRoot, "s2a-contract-"))
  try {
    const base = join(out, "base")
    const config = writeProjectConfig(join(out, "swagger2api.json"), {
      source: join(root, "fixtures", "swagger.json"),
      output: base,
      base: { output: { name: "index", mode: "grouped" }, grouping: { strategy: ["path"], pathDepth: 0 } }
    })
    const generated = spawnSync(
      process.execPath,
      [cli, "-c", config, "--axios", "--responses", "--js", "-err", "-rpi", "0", "-erq", "arg0", "-cg"],
      { cwd: out, encoding: "utf8" },
    )
    if (generated.status !== 0) {
      console.error("✖ 分组产物对外面：生成失败")
      console.error(`${generated.stdout ?? ""}${generated.stderr ?? ""}`)
      return 1
    }

    const issues = []
    const aggregate = readFileSync(join(base, "index.js"), "utf8")
    if (!aggregate.includes('export * from "./client"')) issues.push("聚合入口未导出 client")
    if (!aggregate.includes('export * from "./types"')) issues.push("聚合入口未导出 types")
    // 模块通过聚合实例注入，替换 instance 才能传导到各组
    if (!aggregate.includes("app = new App(this)")) issues.push("聚合入口未注入共享客户端")
    const appDts = readFileSync(join(base, "App.d.ts"), "utf8")
    if (!appDts.includes('from "./client"') || !appDts.includes("AxiosResponse")) issues.push("模块声明未引用 client 的 AxiosResponse")
    // 契约出口与新底座在 JS 模式下同样落地
    for (const file of ["client.js", "client.d.ts", "types/index.js", "types/index.d.ts"]) {
      if (!existsSync(join(base, file))) issues.push(`固定产物缺失：${file}`)
    }
    // 运行时枚举落到所属契约文件，出口按公开面同步
    const typesBarrel = readFileSync(join(base, "types/index.js"), "utf8")
    if (!typesBarrel.includes('export { SettingType } from ".')) issues.push("JS 契约出口未导出运行时枚举")
    if (!readFileSync(join(base, "types/index.d.ts"), "utf8").includes("export type {")) issues.push("JS 声明出口缺少类型导出")
    const runtimeOwner = collectFiles(base).find(
      (file) => file.startsWith("types/") && file.endsWith(".js") && file !== "types/index.js" && readFileSync(join(base, file), "utf8").includes("export var SettingType"),
    )
    if (!runtimeOwner) issues.push("运行时枚举未落到所属契约文件")

    // 复刻下游仓形态：桶文件再导出聚合入口，declare.ts 以相对聚合入口做模块增强
    writeFileSync(join(out, "index.ts"), 'export * from "./base"\n')
    writeFileSync(
      join(out, "declare.ts"),
      [
        "export {}",
        "interface AxiosResponseRaw<T = any> {",
        "  success: boolean",
        "  code: number",
        "  message: string",
        "  data: T",
        "}",
        'declare module "." {',
        "  interface AxiosResponse<T> extends AxiosResponseRaw<T> {}",
        "}",
        ""
      ].join("\n"),
    )
    writeFileSync(
      join(out, "probe.ts"),
      [
        'import { Api } from "./index.js"',
        "",
        "const api = new Api()",
        "type Settled = Awaited<ReturnType<typeof api.api.settingsQuery>>",
        'type Data = Settled extends { data?: infer D } ? D : "NO_DATA"',
        "// 期望推导为夹具 Setting 契约，而不是 unknown / never",
        "const assertData: Data extends { key?: string } ? true : false = true",
        "// 两个组的类型交叉不得坍缩为 never（下游用于多平台兼容）",
        "type Both = typeof api.app & typeof api.home",
        "const assertIntersect: Both extends never ? never : true = true",
        "void assertData",
        "void assertIntersect",
        "void api.instance",
        ""
      ].join("\n"),
    )
    writeFileSync(
      join(out, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            skipLibCheck: true,
            noEmit: true
          },
          include: ["probe.ts", "declare.ts", "index.ts"]
        },
        null,
        2,
      ),
    )
    const probe = spawnSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", out], { cwd: out, encoding: "utf8" })
    if (probe.status !== 0) {
      issues.push("响应类型未恢复为具体契约")
      console.error(`${probe.stdout ?? ""}${probe.stderr ?? ""}`)
    }

    if (issues.length === 0) return 0
    console.error(`\n✖ 分组产物对外面未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 契约冲突：契约名与模块类名同名时类名避让，与底座同名时根出口仍能取到底座。
 * @return {number} 退出码
 */
async function checkContractCollision() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 契约冲突：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-contract-"))
  try {
    const api = join(out, "api")
    const config = writeProjectConfig(join(out, "config.json"), {
      source: join(root, "fixtures", "contract-collision.json"),
      output: api,
      base: { output: { name: "index", mode: "grouped" } }
    })
    const result = spawnSync(process.execPath, [cli, "-c", config], { cwd: out, encoding: "utf8" })
    if (result.status !== 0) {
      console.error("✖ 契约冲突：生成失败")
      console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`)
      return 1
    }
    const issues = []
    const aggregate = readFileSync(join(api, "index.ts"), "utf8")
    if (!aggregate.includes("probe = new Probe2(this)")) issues.push("契约同名时模块类未避让")
    if (!aggregate.includes('export { HttpClient } from "./client"')) issues.push("根出口未显式导出底座 HttpClient")
    const barrelFile = join(api, "types/index.d.ts")
    const barrel = readFileSync(existsSync(barrelFile) ? barrelFile : join(api, "types/index.ts"), "utf8")
    if (!barrel.includes("HttpClient")) issues.push("契约 HttpClient 未被生成")
    const module = readFileSync(join(api, "Modules.ts"), "utf8")
    if (!module.includes("export class Probe2")) issues.push("模块类名未按契约避让")
    if (!/import (?:type )?\{ Probe \} from "\.\/types\/index"/.test(module)) issues.push("契约导入缺失")
    if (issues.length) {
      issues.forEach((issue) => console.error(`✖ 契约冲突：${issue}`))
      return 1
    }
    return 0
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 文档形态：缺字段、空文档与 Swagger 2.0 给出可读结论；无契约文档可生成并 --check 通过。
 * @return {number} 退出码
 */
async function checkSpecShape() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 文档形态：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-spec-shape-"))
  const issues = []
  const writeConfig = (name, spec, extra = {}) => {
    const { mode, language, ...base } = extra
    return writeProjectConfig(join(out, `${name}.json`), {
      source: spec,
      output: `./${name}`,
      base: { ...base, output: { name: "index", ...(mode ? { mode } : {}) }, ...(language ? { language } : {}) }
    })
  }
  const run = (config, extra = []) => spawnSync(process.execPath, [cli, "-c", config, ...extra], { cwd: out, encoding: "utf8" })
  const output = (result) => `${result.stdout ?? ""}${result.stderr ?? ""}`
  try {
    // 缺少 paths：可读错误 + 退出码 1；--json 给稳定错误码
    const noPaths = writeConfig("no-paths", join(root, "fixtures", "spec-no-paths.json"), { mode: "grouped" })
    const noPathsRun = run(noPaths)
    if (noPathsRun.status !== 1 || !output(noPathsRun).includes("缺少 paths")) issues.push("缺少 paths 未以可读错误终止")
    if (output(noPathsRun).includes("TypeError")) issues.push("缺少 paths 输出了原始堆栈")
    const noPathsJson = run(noPaths, ["--json"])
    try {
      if (JSON.parse(noPathsJson.stdout).errorCode !== "E_SPEC_INVALID") issues.push("缺少 paths 的 JSON 错误码不正确")
    } catch {
      issues.push("缺少 paths 的 --json 输出无法解析")
    }

    // Swagger 2.0：提示先转 OpenAPI 3
    const swagger2 = writeConfig("swagger2", join(root, "fixtures", "spec-swagger2.json"), { mode: "grouped" })
    const swagger2Run = run(swagger2)
    if (swagger2Run.status !== 1 || !output(swagger2Run).includes("OpenAPI 3")) issues.push("Swagger 2.0 未给出转换提示")
    if (output(swagger2Run).includes("TypeError")) issues.push("Swagger 2.0 输出了原始堆栈")

    // 空 paths：明确「没有接口」
    const empty = writeConfig("empty", join(root, "fixtures", "spec-empty-paths.json"), { mode: "grouped" })
    const emptyRun = run(empty)
    if (emptyRun.status !== 1 || !output(emptyRun).includes("没有接口")) issues.push("空 paths 未给出「没有接口」结论")
    const emptyJson = run(empty, ["--json"])
    try {
      if (JSON.parse(emptyJson.stdout).errorCode !== "E_NO_ENDPOINTS") issues.push("空 paths 的 JSON 错误码不正确")
    } catch {
      issues.push("空 paths 的 --json 输出无法解析")
    }

    // null 路径项与 null components：跳过并告警，其余接口正常生成
    const nulls = writeConfig("nulls", join(root, "fixtures", "spec-null-nodes.json"), { mode: "grouped" })
    const nullsRun = run(nulls)
    if (nullsRun.status !== 0) issues.push(`null 节点文档生成失败：${output(nullsRun)}`)
    else {
      if (!output(nullsRun).includes("已跳过非法路径项：/bad")) issues.push("非法路径项缺少跳过告警")
      if (!existsSync(join(out, "nulls", "Modules.ts"))) issues.push("null 节点文档未生成模块文件")
      if (run(nulls, ["--check"]).status !== 0) issues.push("null 节点文档 --check 未通过")
    }

    // 无契约：TS 分组补写空出口，--check 通过
    const noSchemas = writeConfig("no-schemas", join(root, "fixtures", "spec-no-schemas.json"), { mode: "grouped" })
    const noSchemasRun = run(noSchemas)
    if (noSchemasRun.status !== 0) issues.push(`无契约文档生成失败：${output(noSchemasRun)}`)
    else {
      const barrel = join(out, "no-schemas", "types", "index.ts")
      if (!existsSync(barrel)) issues.push("无契约文档未补写 types/index.ts")
      else {
        const source = readFileSync(barrel, "utf8")
        if (!source.includes(GENERATED_BANNER_ZH) || !source.includes("export {}")) issues.push("空契约出口缺少横幅或导出")
      }
      if (run(noSchemas, ["--check"]).status !== 0) issues.push("无契约文档 --check 未通过")
    }

    // 无契约：JS 分组同时补写实现与声明出口
    const noSchemasJs = writeConfig("no-schemas-js", join(root, "fixtures", "spec-no-schemas.json"), { mode: "grouped", language: "js" })
    const noSchemasJsRun = run(noSchemasJs)
    if (noSchemasJsRun.status !== 0) issues.push(`无契约 JS 文档生成失败：${output(noSchemasJsRun)}`)
    else {
      for (const file of ["types/index.js", "types/index.d.ts"]) if (!existsSync(join(out, "no-schemas-js", file))) issues.push(`无契约 JS 文档缺少 ${file}`)
      if (run(noSchemasJs, ["--check"]).status !== 0) issues.push("无契约 JS 文档 --check 未通过")
    }

    // 无契约：单文件模式不生成 types 目录也能通过
    const noSchemasSingle = writeConfig("no-schemas-single", join(root, "fixtures", "spec-no-schemas.json"))
    const singleRun = run(noSchemasSingle)
    if (singleRun.status !== 0) issues.push(`无契约单文件生成失败：${output(singleRun)}`)
    else if (run(noSchemasSingle, ["--check"]).status !== 0) issues.push("无契约单文件 --check 未通过")

    if (issues.length === 0) return 0
    console.error(`\n✖ 文档形态未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 英文横幅端到端：output.banner: "en" 时所有产物改用英文块，切回 zh 后可重写且 --check 通过。
 * @return {number} 退出码
 */
async function checkBannerLanguage() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 英文横幅：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-banner-lang-"))
  const issues = []
  const api = join(out, "api")
  const config = join(out, "swagger2api.json")
  const writeConfig = (language) =>
    writeProjectConfig(config, {
      source: join(root, "fixtures", "swagger.json"),
      output: api,
      base: { output: { name: "index", mode: "grouped", banner: language } }
    })
  const run = (extra = []) => spawnSync(process.execPath, [cli, "-c", config, ...extra], { cwd: out, encoding: "utf8" })
  const assertLanguage = (anchor, foreign) => {
    const files = collectFiles(api).filter((file) => /\.(?:ts|js)$/.test(file))
    if (files.length === 0) {
      issues.push("英文横幅：未生成任何代码文件")
      return
    }
    for (const file of files) {
      const head = readFileSync(join(api, file), "utf8").slice(0, 1024)
      if (!head.includes(anchor)) issues.push(`横幅语言不符：${file}`)
      if (head.includes(foreign)) issues.push(`横幅语言混用：${file}`)
    }
  }
  try {
    writeConfig("en")
    const en = run()
    if (en.status !== 0) issues.push(`英文横幅生成失败：${en.stderr ?? ""}`)
    else {
      assertLanguage(GENERATED_BANNER, GENERATED_BANNER_ZH)
      if (run(["--check"]).status !== 0) issues.push("英文横幅 --check 未通过")
    }

    writeConfig("zh")
    const zh = run()
    if (zh.status !== 0) issues.push(`切回中文横幅失败：${zh.stderr ?? ""}`)
    else {
      assertLanguage(GENERATED_BANNER_ZH, GENERATED_BANNER)
      if (run(["--check"]).status !== 0) issues.push("切回中文横幅 --check 未通过")
    }

    if (issues.length === 0) return 0
    console.error(`\n✖ 英文横幅未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 生成失败回滚：后处理失败时清理本轮新增产物、保留原有文件，且可直接重跑。
 * @return {number} 退出码
 */
async function checkGenerationRollback() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 生成失败回滚：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-rollback-verify-"))
  const issues = []
  try {
    const api = join(out, "api")
    mkdirSync(join(api, "types"), { recursive: true })
    const hand = join(api, "types", "Modules.ts")
    writeFileSync(hand, "// 手写契约\n")
    const config = writeProjectConfig(join(out, "swagger2api.json"), {
      source: join(root, "fixtures", "swagger.json"),
      output: "./api",
      base: { output: { name: "index", mode: "grouped" } }
    })
    const run = (extra = []) => spawnSync(process.execPath, [cli, "-c", config, ...extra], { cwd: out, encoding: "utf8" })
    const output = (result) => `${result.stdout ?? ""}${result.stderr ?? ""}`

    // 后处理阶段失败：提示手写冲突，回滚本轮新增文件，原有手写文件保持不动
    const failed = run()
    if (failed.status === 0) issues.push("手写契约冲突未终止生成")
    if (!output(failed).includes("手写文件")) issues.push("手写契约冲突缺少提示")
    if (!output(failed).includes("回滚：")) issues.push("失败后未执行产物回滚")
    const leftovers = collectFiles(api).filter((file) => file !== "types/Modules.ts")
    if (leftovers.length > 0) issues.push(`失败后仍残留新增产物：${leftovers.join("、")}`)
    if (!readFileSync(hand, "utf8").includes("手写契约")) issues.push("回滚删除了原有手写文件")

    // 移除冲突后可直接重跑，且 --check 通过
    rmSync(hand)
    const retry = run()
    if (retry.status !== 0) issues.push(`失败后重跑未成功：${output(retry)}`)
    else if (run(["--check"]).status !== 0) issues.push("失败重跑后 --check 未通过")

    // --check 失败路径不创建真实产物目录
    const missingDir = join(out, "missing")
    const missingConfig = writeProjectConfig(join(out, "missing.json"), {
      source: join(root, "fixtures", "swagger.json"),
      output: "./missing",
      base: { output: { name: "index", mode: "grouped" } }
    })
    const missing = spawnSync(process.execPath, [cli, "-c", missingConfig, "--check"], { cwd: out, encoding: "utf8" })
    if (missing.status === 0) issues.push("--check 缺少产物目录时未报错")
    if (existsSync(missingDir)) issues.push("--check 失败时创建了真实产物目录")

    if (issues.length === 0) return 0
    console.error(`\n✖ 生成失败回滚未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 自适应分桶与分片：桶内多类、分片门面、聚合导入、横幅归属与关闭开关回滚。
 * 生成后编译类型探针，断言分片合并后的调用形态与单文件产物一致。
 * @return {number} 退出码
 */
async function checkGroupedSplit() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 自适应分桶与分片：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const ts = await import("typescript")
  // 放在 node_modules/.cache 下，便于 tsc 向上解析本仓的 axios 类型
  const cacheRoot = join(root, "node_modules", ".cache")
  mkdirSync(cacheRoot, { recursive: true })
  const out = mkdtempSync(join(cacheRoot, "s2a-split-"))
  const base = join(out, "api")
  const issues = []
  try {
    const writeConfig = (name, dir, grouping, extra = {}) =>
      writeProjectConfig(join(out, name), {
        source: join(root, "fixtures", "grouping-split.json"),
        output: dir,
        base: { output: { name: "index", mode: "grouped" }, client: "axios", grouping, ...extra }
      })
    const splitGrouping = { strategy: ["path"], pathDepth: 0, split: { minRoutes: 1, targetRoutes: 2, maxRoutes: 3, minBucketRoutes: 2 } }
    const run = (config) => spawnSync(process.execPath, [cli, "-c", config], { cwd: out, encoding: "utf8" })
    const first = run(writeConfig("base.json", base, splitGrouping))
    if (first.status !== 0) {
      console.error("✖ 自适应分桶与分片：生成失败")
      console.error(`${first.stdout ?? ""}${first.stderr ?? ""}`)
      return 1
    }

    const files = readdirSync(base)
    for (const file of ["index.ts", "Modules.ts", "DgAdmin.ts", "DgAdminPart1.ts", "DgAdminPart2.ts"]) {
      if (!files.includes(file)) issues.push(`缺少预期产物：${file}`)
    }
    // 固定布局：客户端底座在根，契约出口在 types/ 子目录
    for (const file of ["client.ts", "types/index.ts"]) {
      if (!existsSync(join(base, file))) issues.push(`缺少固定产物：${file}`)
    }
    // 契约按业务文件拆分：单归属进同名文件，多归属与未使用进 shared
    for (const file of ["types/DgAdminPart1.ts", "types/shared.ts"]) {
      if (!existsSync(join(base, file))) issues.push(`缺少拆分契约：${file}`)
    }
    const splitBarrel = existsSync(join(base, "types/index.ts")) ? readFileSync(join(base, "types/index.ts"), "utf8") : ""
    if (!splitBarrel.includes('export type { Order } from "./DgAdminPart1"')) issues.push("契约出口未导出单归属类型")
    if (!splitBarrel.includes('export type { User } from "./shared"')) issues.push("契约出口未导出共享类型")
    if (files.some((name) => /^DgAdminV\d/i.test(name))) issues.push("版本段被当作子分类生成了文件")
    // 归属判据：桶、分片、门面、聚合入口与契约都带生成横幅
    assertAllGenerated(base, issues)
    assertUniformBanner(base, issues)

    // 桶文件：一个文件内渲染多个命名空间类，且不串入分片命名空间
    const bucket = readFileSync(join(base, "Modules.ts"), "utf8")
    if (!bucket.includes("class App") || !bucket.includes("class Misc")) issues.push("桶文件未在同一文件内渲染多个命名空间类")
    if (!bucket.includes("/app/items") || !bucket.includes("/misc/ping")) issues.push("桶文件缺少本桶接口")
    if (bucket.includes("/dg_admin/")) issues.push("桶文件串入分片命名空间")

    // 分片：按子分类落文件，门面做实例与类型合并
    const part1 = readFileSync(join(base, "DgAdminPart1.ts"), "utf8")
    const part2 = readFileSync(join(base, "DgAdminPart2.ts"), "utf8")
    if (!part1.includes("/dg_admin/v3/order/") || part2.includes("/dg_admin/v3/order/")) issues.push("分片未按子分类切分")
    if (!part2.includes("/dg_admin/v3/user/")) issues.push("分片缺少子分类接口")
    const facade = readFileSync(join(base, "DgAdmin.ts"), "utf8")
    if (!facade.includes("Object.assign(this, new DgAdminPart1(http), new DgAdminPart2(http))")) issues.push("门面未合并分片实例")
    if (!facade.includes('Object.defineProperty(this, "http", { value: http, enumerable: false })') || facade.includes("this.http = http")) {
      issues.push("门面请求器注入不是不可枚举")
    }
    if (!facade.includes("export interface DgAdmin<SecurityDataType = unknown> extends DgAdminPart1<SecurityDataType>, DgAdminPart2<SecurityDataType> {}")) {
      issues.push("门面未合并分片类型")
    }
    if (!part1.includes("declare readonly http: HttpClient<SecurityDataType>")) issues.push("分片缺少只读请求器声明")
    if (part1.includes("declare http:")) issues.push("请求器声明仍为可写")
    if (!bucket.includes("declare readonly http: HttpClient<SecurityDataType>")) issues.push("模块缺少只读请求器声明")

    // 聚合入口：同桶模块合并导入，按命名空间挂载
    const aggregate = readFileSync(join(base, "index.ts"), "utf8")
    if (!aggregate.includes('import { App, Misc } from "./Modules"')) issues.push("聚合入口未合并同桶导入")
    if (!aggregate.includes("dgAdmin = new DgAdmin(this)")) issues.push("聚合入口未挂载分片命名空间")

    // 可复现：同一配置再生成一次，产物集合与内容完全一致（含 types/ 子目录）
    const snapshot = () => Object.fromEntries(collectFiles(base).sort().map((name) => [name, readFileSync(join(base, name), "utf8")]))
    const before = snapshot()
    const second = run(writeConfig("base.json", base, splitGrouping))
    if (second.status !== 0) {
      console.error("✖ 自适应分桶与分片：第二次生成失败")
      console.error(`${second.stdout ?? ""}${second.stderr ?? ""}`)
      return 1
    }
    const after = snapshot()
    if (Object.keys(before).join(",") !== Object.keys(after).join(",")) issues.push("连续两次生成的产物集合不一致")
    else for (const name of Object.keys(before)) if (before[name] !== after[name]) issues.push(`产物不稳定：${name}`)

    // 契约缩水：整组接口被删除后，模块与嵌套契约都要清理，且随后 --check 通过
    const shrinkDir = join(out, "shrink")
    const shrinkSpec = join(out, "shrink-spec.json")
    const shrinkSource = JSON.parse(readFileSync(join(root, "fixtures", "grouping-split.json"), "utf8"))
    for (const pathKey of Object.keys(shrinkSource.paths)) if (pathKey.startsWith("/dg_admin/")) delete shrinkSource.paths[pathKey]
    writeFileSync(shrinkSpec, JSON.stringify(shrinkSource, null, 2))
    const shrinkConfig = (name, specFile) =>
      writeProjectConfig(join(out, name), {
        source: specFile,
        output: shrinkDir,
        base: { output: { name: "index", mode: "grouped" }, client: "axios", grouping: splitGrouping }
      })
    const shrinkBefore = run(shrinkConfig("shrink-before.json", join(root, "fixtures", "grouping-split.json")))
    const shrinkAfter = shrinkBefore.status === 0 ? run(shrinkConfig("shrink-after.json", shrinkSpec)) : shrinkBefore
    if (shrinkBefore.status !== 0 || shrinkAfter.status !== 0) {
      issues.push("契约缩水场景生成失败")
      console.error(`${shrinkAfter.stdout ?? ""}${shrinkAfter.stderr ?? ""}`)
    } else {
      const leftovers = collectFiles(shrinkDir).filter((name) => /^(?:types\/)?DgAdmin/.test(name))
      if (leftovers.length) issues.push(`契约缩水后残留：${leftovers.join(", ")}`)
      const shrinkCheck = spawnSync(process.execPath, [cli, "-c", shrinkConfig("shrink-check.json", shrinkSpec), "--check"], { cwd: out, encoding: "utf8" })
      if (shrinkCheck.status !== 0) {
        issues.push("契约缩水后 --check 未通过")
        console.error(`${shrinkCheck.stdout ?? ""}${shrinkCheck.stderr ?? ""}`)
      }
    }

    // 类型探针：分片合并后仍可按命名空间调用，且替换 instance 会传导到分片
    writeFileSync(
      join(out, "probe.ts"),
      [
        'import { Api } from "./api/index"',
        "",
        "const api = new Api()",
        "api.app.appItemsGet()",
        "api.misc.miscPingGet()",
        "api.dgAdmin.dgAdminV3UserListGet()",
        "api.dgAdmin.dgAdminV3OrderDetailGet()",
        "void api.instance",
        ""
      ].join("\n"),
    )
    writeFileSync(
      join(out, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, noEmit: true },
          include: ["probe.ts", "api/index.ts"]
        },
        null,
        2,
      ),
    )
    const probe = spawnSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", out], { cwd: out, encoding: "utf8" })
    if (probe.status !== 0) {
      issues.push("分片合并后调用形态与单文件产物不一致")
      console.error(`${probe.stdout ?? ""}${probe.stderr ?? ""}`)
    }

    // 关闭 split 回滚：恢复一命名空间一文件，不残留分片产物
    const legacy = join(out, "legacy")
    const rolled = run(writeConfig("legacy.json", legacy, { strategy: ["path"], pathDepth: 0 }))
    if (rolled.status !== 0) {
      issues.push("关闭 split 后生成失败")
    } else {
      const legacyFiles = readdirSync(legacy)
      for (const file of ["App.ts", "DgAdmin.ts", "Misc.ts"]) if (!legacyFiles.includes(file)) issues.push(`回滚后缺少 ${file}`)
      if (legacyFiles.some((name) => /Part\d+\.ts$/.test(name))) issues.push("关闭 split 后仍残留分片产物")
    }

    // JS 模式：门面实现与声明都要落地，且能被 TS 解析
    const jsDir = join(out, "js")
    const jsRun = run(writeConfig("js.json", jsDir, splitGrouping, { language: { target: "js" } }))
    if (jsRun.status !== 0) {
      issues.push("JS 模式生成失败")
    } else {
      const jsFiles = readdirSync(jsDir)
      for (const file of ["DgAdmin.js", "DgAdmin.d.ts", "client.js", "client.d.ts"]) if (!jsFiles.includes(file)) issues.push(`JS 模式缺少 ${file}`)
      for (const file of ["types/index.js", "types/index.d.ts"]) {
        if (!existsSync(join(jsDir, file))) issues.push(`JS 模式缺少 ${file}`)
      }
      if (!existsSync(join(jsDir, "DgAdmin.js")) || !readFileSync(join(jsDir, "DgAdmin.js"), "utf8").includes("Object.assign(this")) {
        issues.push("JS 模式门面未合并分片实例")
      }
      for (const file of collectFiles(jsDir).filter((name) => name.endsWith(".d.ts"))) {
        const source = ts.createSourceFile(file, readFileSync(join(jsDir, file), "utf8"), ts.ScriptTarget.Latest, true)
        if (source.parseDiagnostics.length > 0) issues.push(`JS 声明无法解析：${file}`)
      }
      // JS 模式的声明文件与门面实现同样要带横幅，否则下一轮会被误判为手写文件
      assertAllGenerated(jsDir, issues)
    }

    if (issues.length === 0) return 0
    console.error(`\n✖ 自适应分桶与分片未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 分桶合并：中间小桶并入相邻桶，不出现碎片文件。
 * 走 `--dry-run --json` 读取 split 报表，不落盘。
 * @return {number} 退出码
 */
async function checkSplitSmallBuckets() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 分桶合并：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-small-bucket-"))
  try {
    const config = writeProjectConfig(join(out, "swagger2api.json"), {
      source: join(root, "fixtures", "grouping-small-bucket.json"),
      output: join(out, "api"),
      base: {
        output: { name: "index", mode: "grouped" },
        grouping: { strategy: ["path"], pathDepth: 0, split: { minRoutes: 1, targetRoutes: 10, maxRoutes: 15, minBucketRoutes: 2 } }
      }
    })
    const result = spawnSync(process.execPath, [cli, "-c", config, "--dry-run", "--json"], { cwd: out, encoding: "utf8" })
    if (result.status !== 0) {
      console.error("✖ 分桶合并：报表失败")
      console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`)
      return 1
    }
    // 分组日志先行，从首个 { 起截取结构化报表；多文档模式取首个文档的报表
    const payload = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")))
    const report = payload.docs ? payload.docs[0].report : payload
    const buckets = report.split?.buckets ?? []
    const routes = buckets.map((bucket) => bucket.routes)
    if (routes.join(",") !== "11,13,10,3") {
      console.error(`✖ 分桶合并：桶体量与预期不符（${routes.join(",")}）`)
      return 1
    }
    if (buckets.some((bucket) => bucket.routes < 2)) {
      console.error("✖ 分桶合并：仍存在碎片桶")
      return 1
    }
    return 0
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 手动模块化（横幅清理）：连续生成时清理已消失模块，`--check` 能发现缺失、不一致与多余产物。
 * @return {number} 退出码
 */
async function checkManualModularPrune() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 手动模块化清理：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-manual-modular-"))
  const api = join(out, "api")
  try {
    const spec = JSON.parse(readFileSync(join(root, "fixtures", "grouping-split.json"), "utf8"))
    const writeConfig = (name) => {
      const input = join(out, `${name}.json`)
      writeFileSync(input, JSON.stringify(spec))
      return writeProjectConfig(join(out, "swagger2api.json"), {
        source: input,
        output: api,
        base: { output: { name: "index" } }
      })
    }
    const run = (config, extra = []) => spawnSync(process.execPath, [cli, "-c", config, "--modular", ...extra], { cwd: out, encoding: "utf8" })

    const first = run(writeConfig("full"))
    if (first.status !== 0) {
      console.error("✖ 手动模块化清理：首次生成失败")
      console.error(`${first.stdout ?? ""}${first.stderr ?? ""}`)
      return 1
    }
    if (!existsSync(join(api, "Misc.ts"))) {
      console.error("✖ 手动模块化清理：首次生成缺少 Misc.ts")
      return 1
    }

    delete spec.paths["/misc/ping"]
    const second = run(writeConfig("trimmed"))
    if (second.status !== 0) {
      console.error("✖ 手动模块化清理：二次生成失败")
      console.error(`${second.stdout ?? ""}${second.stderr ?? ""}`)
      return 1
    }
    // 顶层模块与嵌套契约都要清干净：只删模块文件会留下幽灵契约
    const leftovers = collectFiles(api).filter((name) => /^(?:types\/)?Misc\.(?:ts|js|d\.ts)$/.test(name))
    if (leftovers.length) {
      console.error(`✖ 手动模块化清理：已消失模块残留 ${leftovers.join("、")}`)
      return 1
    }
    const aggregate = readFileSync(join(api, "index.ts"), "utf8")
    if (aggregate.includes("Misc")) {
      console.error("✖ 手动模块化清理：聚合入口仍引用已清理模块")
      return 1
    }

    const checkOk = run(writeConfig("trimmed"), ["--check"])
    if (checkOk.status !== 0) {
      console.error("✖ 手动模块化清理：--check 未通过")
      console.error(`${checkOk.stdout ?? ""}${checkOk.stderr ?? ""}`)
      return 1
    }
    rmSync(join(api, "App.ts"))
    const checkBroken = run(writeConfig("trimmed"), ["--check"])
    if (checkBroken.status === 0 || !`${checkBroken.stdout ?? ""}${checkBroken.stderr ?? ""}`.includes("缺少产物")) {
      console.error("✖ 手动模块化清理：--check 未发现缺失产物")
      return 1
    }
    // 多余产物：真实目录中带横幅、但本轮不生成的文件按「产物多余」报出
    writeFileSync(join(api, "Stale.ts"), `/* ## ${GENERATED_BANNER} ## */\nexport {}\n`)
    const checkExtra = run(writeConfig("trimmed"), ["--check"])
    if (checkExtra.status === 0 || !`${checkExtra.stdout ?? ""}${checkExtra.stderr ?? ""}`.includes("产物多余")) {
      console.error("✖ 手动模块化清理：--check 未发现多余产物")
      return 1
    }
    return 0
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 项目配置与产物校验：一份 swagger2api.json 驱动分组生成，产物靠横幅归属，--check 能发现缺失、篡改与多余。
 * @return {number} 退出码
 */
async function checkFlatConfig() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 项目配置与产物校验：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-flat-"))
  const api = join(out, "api")
  const issues = []
  try {
    // 业务仓只写项目口径，分桶阈值、清单、清理由工具默认
    writeProjectConfig(join(out, "swagger2api.json"), {
      source: join(root, "fixtures", "grouping-split.json"),
      output: "./api",
      base: {
        output: { name: "index", mode: "grouped" },
        client: "axios",
        types: { responses: true, extractQuery: "param,arg0", extractResponseRaw: true },
        naming: { pathPrefixIndex: 0 }
      }
    })
    const run = (extra = []) => spawnSync(process.execPath, [cli, ...extra], { cwd: out, encoding: "utf8" })
    const first = run()
    if (first.status !== 0) {
      console.error("✖ 项目配置与产物校验：生成失败")
      console.error(`${first.stdout ?? ""}${first.stderr ?? ""}`)
      return 1
    }

    const files = readdirSync(api)
    for (const file of ["index.ts", "Modules.ts"]) {
      if (!files.includes(file)) issues.push(`缺少预期产物：${file}`)
    }
    // 固定布局：客户端底座在根，契约出口在 types/ 子目录
    for (const file of ["client.ts", "types/index.ts"]) {
      if (!existsSync(join(api, file))) issues.push(`缺少固定产物：${file}`)
    }
    // 契约按业务文件拆分：出口只保留显式导出，声明落到 types/<业务文件>
    const typesIndex = readFileSync(join(api, "types/index.ts"), "utf8")
    if (typesIndex.includes("export interface ")) issues.push("契约声明仍堆在出口文件")
    if (!typesIndex.includes("export type {")) issues.push("契约出口缺少显式导出")
    const splitTypes = collectFiles(api).filter((file) => file.startsWith("types/") && file.endsWith(".ts") && file !== "types/index.ts")
    if (!splitTypes.length) issues.push("契约未按业务文件拆分")
    else if (!splitTypes.some((file) => readFileSync(join(api, file), "utf8").includes("export interface "))) issues.push("拆分后的契约文件缺少声明")
    if (files.includes(".swagger2api.manifest.json")) issues.push("产物目录混入清单文件")
    // 归属判据：所有生成文件带横幅，产物目录不落清单等额外状态
    assertAllGenerated(api, issues)
    const bucket = readFileSync(join(api, "Modules.ts"), "utf8")
    for (const name of ["class App", "class DgAdmin", "class Misc"]) {
      if (!bucket.includes(name)) issues.push(`单桶文件缺少 ${name}`)
    }
    const aggregate = readFileSync(join(api, "index.ts"), "utf8")
    if (!aggregate.includes('import { App, DgAdmin, Misc } from "./Modules"')) issues.push("聚合入口未合并单桶导入")
    if (!aggregate.includes('export * from "./types"')) issues.push("聚合入口未导出 types")
    if (!aggregate.includes('export * from "./client"')) issues.push("聚合入口未导出 client")
    if (!readFileSync(join(api, "client.ts"), "utf8").includes("axios")) issues.push("项目配置的 client 未生效")

    // 升级退场：旧版固定产物在成功生成后自动删除
    writeFileSync(join(api, "data-contracts.ts"), "// 旧产物\n")
    writeFileSync(join(api, "http-client.ts"), "// 旧产物\n")
    const migrated = run()
    if (migrated.status !== 0) issues.push("旧产物退场：重新生成失败")
    else {
      for (const file of ["data-contracts.ts", "http-client.ts"]) {
        if (existsSync(join(api, file))) issues.push(`旧产物未清理：${file}`)
      }
    }

    // 一致时通过，且不写真实目录
    const ok = run(["--check"])
    if (ok.status !== 0) {
      issues.push("--check 对一致产物判失败")
      console.error(`${ok.stdout ?? ""}${ok.stderr ?? ""}`)
    }

    // --check --json：stdout 只有一份 JSON，字段固定，供 AI 与 CI 直接消费
    const jsonOk = run(["--check", "--json"])
    if (jsonOk.status !== 0) {
      issues.push("--check --json 对一致产物判失败")
      console.error(`${jsonOk.stdout ?? ""}${jsonOk.stderr ?? ""}`)
    } else {
      try {
        const summary = JSON.parse(jsonOk.stdout)
        if (summary.schemaVersion !== 1) issues.push("--check --json 缺少 schemaVersion")
        if (!summary.toolVersion) issues.push("--check --json 缺少 toolVersion")
        if (summary.command !== "check") issues.push("--check --json 缺少 command")
        if (summary.ok !== true) issues.push("--check --json 结论错误")
        if (summary.errorCode !== null) issues.push("--check --json 成功时 errorCode 应为 null")
        for (const key of ["missing", "mismatched", "extra", "actions"]) {
          if (!Array.isArray(summary[key])) issues.push(`--check --json 缺少 ${key} 列表`)
        }
      } catch (error) {
        issues.push(`--check --json 输出无法解析：${error.message}`)
      }
    }

    // 篡改后必须失败，且真实产物保持篡改状态（校验不落地）
    writeFileSync(join(api, "Modules.ts"), `${readFileSync(join(api, "Modules.ts"), "utf8")}\n// tampered\n`)
    const tampered = run(["--check"])
    if (tampered.status === 0) issues.push("--check 未发现产物篡改")
    if (!`${tampered.stdout ?? ""}${tampered.stderr ?? ""}`.includes("产物不一致")) issues.push("--check 缺少差异提示")
    if (!readFileSync(join(api, "Modules.ts"), "utf8").includes("// tampered")) issues.push("--check 改写了真实产物")

    // 差异时的 --json：纯 JSON、稳定错误码与可执行动作
    const tamperedJson = run(["--check", "--json"])
    if (tamperedJson.status !== 1) issues.push(`--check --json 差异时未以退出码 1 结束（实际 ${tamperedJson.status}）`)
    try {
      const summary = JSON.parse(tamperedJson.stdout)
      if (summary.ok !== false || summary.errorCode !== "E_CHECK_FAILED") issues.push("--check --json 差异时错误码不正确")
      if (!summary.mismatched.includes("Modules.ts")) issues.push("--check --json 未列出不一致文件")
      if (!summary.actions?.length) issues.push("--check --json 差异时缺少 actions")
    } catch (error) {
      issues.push(`--check --json 差异输出无法解析：${error.message}`)
    }

    // 删除后必须报缺失
    rmSync(join(api, "Modules.ts"))
    const missing = run(["--check"])
    if (missing.status === 0) issues.push("--check 未发现产物缺失")
    if (!`${missing.stdout ?? ""}${missing.stderr ?? ""}`.includes("缺少产物")) issues.push("--check 缺少缺失提示")

    // 模式切换：单文件模式不自动删除旧分组产物，只提示清理方式
    writeFileSync(join(api, "Modules.ts"), `/* ## ${GENERATED_BANNER} ## */\nexport {}\n`)
    const singleDir = join(out, "single")
    mkdirSync(singleDir, { recursive: true })
    writeProjectConfig(join(singleDir, "swagger2api.json"), {
      source: join(root, "fixtures", "grouping-split.json"),
      output: "../api",
      base: { output: { name: "index" } }
    })
    const single = spawnSync(process.execPath, [cli], { cwd: singleDir, encoding: "utf8" })
    if (single.status !== 0) issues.push("单文件模式切换生成失败")
    else if (!`${single.stdout ?? ""}${single.stderr ?? ""}`.includes("分组模式产物")) issues.push("单文件模式未提示旧分组产物")

    if (issues.length === 0) return 0
    console.error(`\n✖ 项目配置与产物校验未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 类型检查策略：enforce 剥离生成物的 @ts-nocheck 且 --check 通过，默认 skip 保持原产物。
 * @return {number} 退出码
 */
async function checkTypeCheckPolicy() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 类型检查策略：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-typecheck-"))
  const issues = []
  try {
    const spec = join(root, "fixtures", "swagger.json")
    const writeConfig = (name, extra) => {
      const { typeCheck, language, ...base } = extra
      return writeProjectConfig(join(out, `${name}.json`), {
        source: spec,
        output: `./${name}`,
        base: {
          ...base,
          output: { name: "index", ...(typeCheck ? { typeCheck } : {}) },
          ...(language ? { language } : {})
        }
      })
    }
    const run = (config, extra = []) => spawnSync(process.execPath, [cli, "-c", config, ...extra], { cwd: out, encoding: "utf8" })
    const fail = (label, result) => {
      console.error(`✖ 类型检查策略：${label}失败`)
      console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`)
    }

    // enforce：生成后无 @ts-nocheck，且 --check 与真实产物一致
    const enforce = writeConfig("enforce", { typeCheck: "enforce" })
    const enforcedRun = run(enforce)
    if (enforcedRun.status !== 0) {
      fail("enforce 生成", enforcedRun)
      return 1
    }
    if (readFileSync(join(out, "enforce", "index.ts"), "utf8").includes("@ts-nocheck")) issues.push("enforce 产物仍含 @ts-nocheck")
    const checkOk = run(enforce, ["--check"])
    if (checkOk.status !== 0) {
      issues.push("enforce 时 --check 未通过")
      console.error(`${checkOk.stdout ?? ""}${checkOk.stderr ?? ""}`)
    }

    // 默认 skip：保留生成器写入的注释
    const skip = writeConfig("skip", {})
    const skippedRun = run(skip)
    if (skippedRun.status !== 0) {
      fail("默认生成", skippedRun)
      return 1
    }
    if (!readFileSync(join(out, "skip", "index.ts"), "utf8").includes("// @ts-nocheck")) issues.push("默认 skip 未保留 @ts-nocheck")

    // JS 模式的声明文件同样处理
    const js = writeConfig("js", { typeCheck: "enforce", language: "js" })
    const jsRun = run(js)
    if (jsRun.status !== 0) {
      fail("JS 模式生成", jsRun)
      return 1
    }
    if (readFileSync(join(out, "js", "index.d.ts"), "utf8").includes("@ts-nocheck")) issues.push("enforce 未处理 JS 声明文件")

    if (issues.length === 0) return 0
    console.error(`\n✖ 类型检查策略未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

/**
 * 接口面基线：提取请求与类型、写基线、与基线比对，多目标按 id 分组校验目标集合。
 * @return {number} 退出码
 */
async function checkSurfaceCommand() {
  const cli = join(root, "dist", "cli.js")
  if (!existsSync(cli)) {
    console.error("✖ 接口面基线：未找到 dist/cli.js，需先构建或提供构建产物")
    return 1
  }
  const out = mkdtempSync(join(tmpdir(), "s2a-surface-"))
  const issues = []
  const run = (args, cwd = out) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" })
  try {
    const spec = join(root, "fixtures", "swagger.json")
    const single = writeProjectConfig(join(out, "single.json"), {
      source: spec,
      output: "./api",
      base: { output: { name: "index" } }
    })
    const generated = run(["-c", single])
    if (generated.status !== 0) {
      console.error("✖ 接口面基线：生成失败")
      console.error(`${generated.stdout ?? ""}${generated.stderr ?? ""}`)
      return 1
    }

    // 写基线：单目标直接平铺，带格式版本
    const baseline = join(out, ".swagger2api", "surface.json")
    const written = run(["surface", "-c", single, "--out", baseline])
    if (written.status !== 0) {
      console.error("✖ 接口面基线：写基线失败")
      console.error(`${written.stdout ?? ""}${written.stderr ?? ""}`)
      return 1
    }
    const payload = JSON.parse(readFileSync(baseline, "utf8"))
    if (payload.formatVersion !== 1) issues.push("基线缺少格式版本")
    if (!Array.isArray(payload.requests) || payload.requests.length !== 3) issues.push("基线接口数量不符")
    if (!Array.isArray(payload.types) || payload.types.length === 0) issues.push("基线未提取导出类型")

    // 一致时通过，缺失基线时报错
    if (run(["surface", "-c", single, "--compare", baseline]).status !== 0) issues.push("基线一致时比对未通过")
    const missing = run(["surface", "-c", single, "--compare", join(out, "missing.json")])
    if (missing.status === 0 || !`${missing.stdout ?? ""}${missing.stderr ?? ""}`.includes("基线文件不存在")) issues.push("缺失基线未报错")

    // 改名只影响 @name：默认比对失败，--requests-only 通过
    const entry = join(out, "api", "index.ts")
    writeFileSync(entry, readFileSync(entry, "utf8").replace(/@name ([A-Za-z]+)/, (_, name) => `@name ${name}Renamed`))
    const renamed = run(["surface", "-c", single, "--compare", baseline])
    if (renamed.status === 0 || !`${renamed.stdout ?? ""}`.includes("+ 接口")) issues.push("改名后默认比对未标出接口变化")
    if (run(["surface", "-c", single, "--compare", baseline, "--requests-only"]).status !== 0) issues.push("--requests-only 未忽略方法名变化")

    // 结构化输出与多目标分组
    const jsonRun = run(["surface", "-c", single, "--json"])
    if (jsonRun.status !== 0 || JSON.parse(jsonRun.stdout).formatVersion !== 1) issues.push("--json 结构不符")
    const multi = join(out, "multi.json")
    writeFileSync(
      multi,
      JSON.stringify(
        {
          base: { output: { name: "index" } },
          docs: [
            { id: "base", source: spec, output: "./multi/base" },
            { id: "lc", source: spec, output: "./multi/lc" }
          ]
        },
        null,
        2
      )
    )
    if (run(["-c", multi, "--all"]).status !== 0) issues.push("多目标生成失败")
    const multiBaseline = join(out, "multi-surface.json")
    if (run(["surface", "-c", multi, "--out", multiBaseline]).status !== 0) issues.push("多目标写基线失败")
    else {
      const grouped = JSON.parse(readFileSync(multiBaseline, "utf8"))
      if (!grouped.targets?.base || !grouped.targets?.lc) issues.push("多目标基线未按 id 分组")
    }
    const partial = run(["surface", "-c", multi, "--target", "base", "--compare", multiBaseline])
    if (partial.status === 0 || !`${partial.stderr ?? ""}`.includes("缺失目标：lc")) issues.push("目标集合变化未报错")
    if (run(["surface", "-c", multi, "--target", "nope"]).status !== 2) issues.push("未知目标未以退出码 2 结束")

    if (issues.length === 0) return 0
    console.error(`\n✖ 接口面基线未通过：${issues.length} 项`)
    for (const issue of issues) console.error(`  - ${issue}`)
    return 1
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
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
  // vitest 4 依赖 node20 才有的 node:fs API，node18 运行时回归只跳过测试，其余生成链路步骤照跑
  { label: "单元测试", command: "pnpm", args: ["test"], skip: runtimeOnly ? "运行时回归模式（vitest 4 依赖 node20 API）" : "" },
  // 走 lint 脚本而非直接调 eslint：检查范围（显式 glob）与冷缓存开关都收在 package.json 一处，避免两处漂移
  { label: "静态检查（冷缓存）", command: "pnpm", args: ["lint"], skip: runtimeOnly ? "运行时回归模式" : "" },
  { label: "构建", command: "pnpm", args: ["build"], skip: runtimeOnly ? "运行时回归模式" : "" },
  { label: "文档站构建（死链检查）", command: "pnpm", args: ["docs:build"], skip: runtimeOnly ? "运行时回归模式" : skipDocs ? "--skip-docs" : docsNeeded ? "" : "未触及 docs/、README.md、依赖清单" },
  // 产物断言依赖构建结果，运行时回归模式由 node20 job 的 dist 产物提供
  { label: "文档站产物（404 排除站点地图与搜索索引）", run: checkDocsDist, skip: runtimeOnly ? "运行时回归模式" : skipDocs ? "--skip-docs" : docsNeeded ? "" : "未触及 docs/、README.md、依赖清单" },
  { label: "包导出冒烟（dist/index.js）", run: smokeExports },
  { label: "技能打包与定位（skills/** / skill 命令）", run: checkSkillPackage, skip: runtimeOnly ? "运行时回归模式" : "" },
  { label: "技能规范校验（toolkit skills lint）", run: checkSkillsLint, skip: runtimeOnly ? "运行时回归模式" : "" },
  { label: "生成产物一致性（夹具）", run: checkGeneratedOutput },
  { label: "分组产物一致性（axios / fetch）", run: checkGroupedOutput },
  { label: "分组产物对外面（导出面 / 类型链 / 共享实例）", run: checkGroupedContract },
  { label: "自适应分桶与分片（桶内多类 / 门面合并 / 回滚）", run: checkGroupedSplit },
  { label: "分桶合并（中间小桶并入相邻桶）", run: checkSplitSmallBuckets },
  { label: "手动模块化清理（横幅 / --check）", run: checkManualModularPrune },
  { label: "扁平配置与产物校验（横幅归属 / --check）", run: checkFlatConfig },
  { label: "类型检查策略（enforce / skip / --check）", run: checkTypeCheckPolicy },
  { label: "接口面基线（提取 / 比对 / 多目标）", run: checkSurfaceCommand },
  { label: "分组命名边界（非 ASCII / 冲突 / 保留名）", run: checkGroupedNaming },
  { label: "分组命名兼容（合并 / 保留名 / 标签参数守卫）", run: checkGroupingCompat },
  { label: "保留名护栏（驼峰聚合成员 / 单文件命名空间）", run: checkReservedNaming },
  { label: "契约冲突（类名避让 / 根出口显式导出）", run: checkContractCollision },
  { label: "文档形态（缺字段 / 空文档 / 无契约）", run: checkSpecShape },
  { label: "英文横幅（生成 / --check / 切回中文）", run: checkBannerLanguage },
  { label: "生成失败回滚（残留 / 重入 / --check 不动真实目录）", run: checkGenerationRollback },
  { label: "产物清理与可复现（横幅清理 / 手写护栏 / 两次一致）", run: checkGroupedPrune },
  { label: "废弃目录清理（默认预览 / --yes / 护栏）", run: checkPruneCommand },
  { label: "非交互保护（缺配置 / init / grouping / 显式配置）", run: checkNonInteractive },
  { label: "文档选择（单文档 / --all / --target / 非交互）", run: checkDocSelection },
  { label: "拉取超时与版本（慢响应 / --timeout / --version）", run: checkTimeoutAndVersion },
  { label: "能力清单漂移（注册表 / 帮助 / 技能地图 / docs / README）", run: checkCapabilityDrift },
  { label: "安全夹具（注入可解析 / 私网引用被拒）", run: checkSecurityFixtures },
  { label: "更新日志同步核验", run: checkChangelogSync, skip: runtimeOnly ? "运行时回归模式" : "" },
  { label: "文档站主题一致性", run: checkDocsTheme, skip: runtimeOnly ? "运行时回归模式" : "" },
  { label: "文档站导航规范（分类 / 命名 / 顶栏）", run: checkDocsNav, skip: runtimeOnly ? "运行时回归模式" : "" },
  { label: "文档链接可达性", run: checkDocLinks, skip: runtimeOnly ? "运行时回归模式" : "" },
  { label: "变更集一致性", run: checkChangeset, skip: runtimeOnly ? "运行时回归模式" : "" },
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
  // run 可能为异步（如安全夹具需动态加载 typescript），统一 await
  const status = step.run ? await step.run() : runCommand(step)

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
