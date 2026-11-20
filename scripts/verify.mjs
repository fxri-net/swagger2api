import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
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
 * 递归收集目录下的文件，返回相对路径数组。
 * @param {string} dir 目录
 * @return {string[]} 相对路径（统一为 / 分隔）
 */
function collectFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(full))
    else files.push(relative(dir, full).split(sep).join("/"))
  }
  return files
}

/**
 * 夹具产物一致性：用夹具生成一次 API，与 fixtures/expected 逐文件比对。
 * 覆盖「真实文档生成 + 模板渲染 + 格式化」整条运行时链路，node20 与 node18 两个 job 都会跑。
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
    const config = join(out, "saconfig.json")
    writeFileSync(config, JSON.stringify({ url: join(fixtures, "swagger.json"), output: out, name: "index" }, null, 2))
    // 与 pnpm api 一致的主力参数组合；配置写到临时目录，避免回写夹具
    const result = spawnSync(process.execPath, [cli, "-c", config, "-q", "--axios", "--responses", "-rpi", "0", "-err"], { cwd: root, stdio: "inherit" })
    if (result.status !== 0) return result.status ?? 1

    const issues = []
    const expectedFiles = collectFiles(expected).filter((file) => file !== "saconfig.json")
    const actualFiles = collectFiles(out).filter((file) => file !== "saconfig.json")
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
    const config = join(outDir, "saconfig.json")
    writeFileSync(config, JSON.stringify({ url: join(securityDir, fixture), output: outDir, name: "index" }, null, 2))
    const result = spawnSync(process.execPath, [cli, "-c", config, "-q", "--axios", "--responses", "-rpi", "0", "-err"], { cwd: root, encoding: "utf8" })
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
    try {
      const config = join(out, "saconfig.json")
      writeFileSync(config, JSON.stringify({ url: join(root, "fixtures", "swagger.json"), output: out, name: "index" }, null, 2))
      const result = spawnSync(process.execPath, [cli, "-c", config, "-q", ...client.args, "--modular", "--module-name-index", "0"], { cwd: root, encoding: "utf8" })
      if (result.status !== 0) {
        console.error(`✖ 分组产物（${client.name}）：生成失败`)
        console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`)
        return 1
      }
      if (!existsSync(join(out, "index.ts"))) {
        console.error(`✖ 分组产物（${client.name}）：缺少聚合入口 index.ts`)
        return 1
      }
      const appModule = readFileSync(join(out, "App.ts"), "utf8")
      if (!appModule.includes("appItemsGet") || appModule.includes("homeDetailPost")) {
        console.error(`✖ 分组产物（${client.name}）：模块文件串组或缺少本组接口`)
        return 1
      }
      for (const file of readdirSync(out).filter((name) => name.endsWith(".ts"))) {
        const source = ts.createSourceFile(file, readFileSync(join(out, file), "utf8"), ts.ScriptTarget.Latest, true)
        if (source.parseDiagnostics.length > 0) {
          console.error(`✖ 分组产物（${client.name}）：${file} 无法解析`)
          return 1
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
  try {
    // 生成器要求输出目录存在，rc 从工作目录向上查找
    writeFileSync(
      join(out, ".swagger2apirc.json"),
      JSON.stringify({
        input: { url: join(root, "fixtures", "grouping-edge.json") },
        output: { dir: out, mode: "grouped", name: "index" },
        client: { type: "axios" },
        grouping: { strategy: ["tag"], names: { "★☆": "symbolGroup" } }
      }, null, 2),
    )
    const result = spawnSync(process.execPath, [cli], { cwd: out, encoding: "utf8" })
    if (result.status !== 0) {
      console.error("✖ 分组命名边界：生成失败")
      console.error(`${result.stdout ?? ""}${result.stderr ?? ""}`)
      return 1
    }
    const expected = ["SymbolGroup.ts", "G20孵化器.ts", "Con2.ts", "Index2.ts", "企业团队管理.ts", "企业团队管理2.ts", "用户管理.ts", "管理端其他功能510红名单管理.ts"]
    const files = readdirSync(out)
    for (const file of expected) {
      if (!files.includes(file)) {
        console.error(`✖ 分组命名边界：缺少预期模块文件 ${file}`)
        return 1
      }
    }
    // JSDoc 保留原始标签，模块名只用于文件与类名
    const userModule = readFileSync(join(out, "用户管理.ts"), "utf8")
    if (!userModule.includes("@tags 用户管理")) {
      console.error("✖ 分组命名边界：JSDoc 未保留原始标签")
      return 1
    }
    const aggregate = readFileSync(join(out, "index.ts"), "utf8")
    for (const property of ["symbolGroup", "g20孵化器", "con2", "index2"]) {
      if (!aggregate.includes(`this.${property}.instance = this.instance`)) {
        console.error(`✖ 分组命名边界：聚合入口缺少 ${property}`)
        return 1
      }
    }
    for (const file of files.filter((name) => name.endsWith(".ts"))) {
      const source = ts.createSourceFile(file, readFileSync(join(out, file), "utf8"), ts.ScriptTarget.Latest, true)
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
  { label: "生成产物一致性（夹具）", run: checkGeneratedOutput },
  { label: "分组产物一致性（axios / fetch）", run: checkGroupedOutput },
  { label: "分组命名边界（非 ASCII / 冲突 / 保留名）", run: checkGroupedNaming },
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
