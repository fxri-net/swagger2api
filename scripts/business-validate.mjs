import { spawn, spawnSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import http from "node:http"
import https from "node:https"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// 接入方仓库本地验证：用本仓 dist/cli.js 代替已发布 CLI，在临时 worktree 内完成
// 「清空产物 → 生成 → --check → 构建 → 冒烟」，不修改接入方依赖与工作区。
// 清单含本机路径，放在仓库外或按 .gitignore 的 scripts/business-*.local.json 忽略。

const toolRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(toolRoot, "dist", "cli.js")
const isWindows = process.platform === "win32"

/** 输出帮助 */
function printHelp() {
  console.log(`用法：node scripts/business-validate.mjs --manifest <清单> [阶段] [选项]

阶段（缺省只做生成与校验）：
  --generate        删除配置声明的产物目录后重新生成，并执行 --check
  --build           按清单中的构建命令逐端构建
  --smoke           逐端启动开发服务并做 HTTP 就绪检查
  --all             依次执行以上三个阶段

选项：
  --only <关键词>   只处理名称包含该关键词的仓库
  --in-place        直接在接入方仓库内执行（不建临时 worktree），产物与清理会写入真实工作区
  --keep            保留临时 worktree 与日志，便于排查
  --json            输出结构化报告
  --timeout <毫秒>  单条命令超时，默认 900000

清单字段（JSON）：
{
  "repos": [{
    "name": "接入方 A",
    "path": "D:/work/repo",
    "configs": ["apps/h5/base/swagger2api.json"],
    "builds": ["pnpm -C apps/h5/base build"],
    "dev": [{ "name": "h5", "command": "pnpm -C apps/h5 dev", "url": "http://localhost:5173" }]
  }]
}`)
}

/**
 * 读取参数。
 * @param {string[]} argv 命令行参数
 * @return {Record<string, any>} 解析结果
 */
function parseArgs(argv) {
  const result = { phases: new Set(), keep: false, json: false, inPlace: false, timeout: 900000 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") result.help = true
    else if (arg === "--manifest") result.manifest = argv[(index += 1)]
    else if (arg === "--only") result.only = argv[(index += 1)]
    else if (arg === "--timeout") result.timeout = Number(argv[(index += 1)])
    else if (arg === "--keep") result.keep = true
    else if (arg === "--in-place") result.inPlace = true
    else if (arg === "--json") result.json = true
    else if (arg === "--generate" || arg === "--build" || arg === "--smoke") result.phases.add(arg.slice(2))
    else if (arg === "--all") ["generate", "build", "smoke"].forEach((phase) => result.phases.add(phase))
    else throw new Error(`未知参数：${arg}`)
  }
  if (result.phases.size === 0) result.phases.add("generate")
  return result
}

/**
 * 执行命令并捕获输出。
 * @param {string} command 命令
 * @param {string[]} args 参数
 * @param {{cwd: string, timeout: number, shell?: boolean}} options 选项
 * @return {{status: number, output: string}} 结果
 */
function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    encoding: "utf8",
    shell: options.shell ?? false,
    stdio: ["ignore", "pipe", "pipe"]
  })
  return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

/**
 * 执行 shell 命令字符串（构建与开发命令）。
 * @param {string} command 命令字符串
 * @param {{cwd: string, timeout: number}} options 选项
 * @return {{status: number, output: string}} 结果
 */
function runShell(command, options) {
  if (isWindows) return run(command, [], { ...options, shell: true })
  return run("sh", ["-c", command], options)
}

/**
 * 判断是否为普通对象。
 * @param {unknown} value 任意值
 * @return {boolean} 是否为对象
 */
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * 从配置中推导本轮的产物目录（相对配置文件目录）。
 * @param {string} configFile 配置文件绝对路径
 * @return {string[]} 产物目录绝对路径
 */
function outputsOf(configFile) {
  const config = JSON.parse(readFileSync(configFile, "utf8"))
  const base = dirname(configFile)
  const items = Array.isArray(config.docs) ? config.docs : Array.isArray(config.targets) ? config.targets : [config]
  return items
    .map((item) => {
      const output = item?.output
      const dir = isObject(output) ? output.dir : output
      return typeof dir === "string" ? resolve(base, dir) : null
    })
    .filter(Boolean)
}

/**
 * 递归收集仓库内的 node_modules 目录（不进入 node_modules 内部）。
 * @param {string} dir 仓库根
 * @param {string} base 基准
 * @return {string[]} 相对路径
 */
function nodeModulesOf(dir, base = dir) {
  const found = []
  if (!existsSync(dir)) return found
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    if (entry.name === "node_modules") {
      found.push(relative(base, join(dir, entry.name)))
      continue
    }
    if (entry.name === ".git") continue
    found.push(...nodeModulesOf(join(dir, entry.name), base))
  }
  return found
}

/**
 * 在 worktree 内复用接入方已安装的依赖目录。
 * @param {string} repo 原仓库根
 * @param {string} worktree 临时 worktree
 * @return {void}
 */
function linkNodeModules(repo, worktree) {
  for (const relativePath of nodeModulesOf(repo)) {
    const source = join(repo, relativePath)
    const target = join(worktree, relativePath)
    if (!existsSync(source) || existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(source, target, isWindows ? "junction" : "dir")
  }
}

/**
 * 创建临时 worktree。
 * @param {string} repo 仓库根
 * @return {{worktree: string, base: string}} 路径
 */
function createWorktree(repo) {
  const base = mkdtempSync(join(tmpdir(), "s2a-business-"))
  const worktree = join(base, "wt")
  const created = run("git", ["-C", repo, "worktree", "add", "--detach", worktree, "HEAD"], { cwd: repo, timeout: 120000 })
  if (created.status !== 0) throw new Error(`创建 worktree 失败：${created.output}`)
  linkNodeModules(repo, worktree)
  return { worktree, base }
}

/**
 * 删除临时 worktree。
 * @param {string} repo 仓库根
 * @param {{worktree: string, base: string}} paths 路径
 * @return {void}
 */
function removeWorktree(repo, paths) {
  run("git", ["-C", repo, "worktree", "remove", "--force", paths.worktree], { cwd: repo, timeout: 120000 })
  run("git", ["-C", repo, "worktree", "prune"], { cwd: repo, timeout: 120000 })
  rmSync(paths.base, { recursive: true, force: true })
}

/** 旧版产物横幅：就地成功生成后据此清理不再覆盖的旧文件 */
const OLD_BANNERS = ["THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API", "本文件由 swagger-typescript-api 生成，请勿手改"]

/**
 * 递归列出文件绝对路径。
 * @param {string} dir 目录
 * @return {string[]} 文件路径
 */
function listFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/**
 * 清空目录内容但保留目录本身：目录可能被编辑器等进程占用，改名或删除会失败。
 * @param {string} dir 目录
 * @return {void}
 */
function clearDirContents(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      clearDirContents(full)
      rmSync(full, { recursive: true, force: true })
      continue
    }
    rmSync(full, { force: true })
  }
}

/**
 * 把备份目录内容逐文件复制回目标目录。
 * @param {string} source 备份目录
 * @param {string} target 目标目录
 * @return {void}
 */
function restoreDir(source, target) {
  if (!existsSync(source)) return
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) restoreDir(from, to)
    else copyFileSync(from, to)
  }
}

/**
 * 清理旧版横幅文件并移除空目录；手写文件与当前横幅文件保留。
 * @param {string} dir 产物目录
 * @return {string[]} 已删除的相对路径
 */
function removeStaleBannerFiles(dir) {
  if (!existsSync(dir)) return []
  const removed = []
  for (const file of listFiles(dir)) {
    if (!/\.(?:ts|js)$/.test(file)) continue
    const head = readFileSync(file, "utf8").slice(0, 1024)
    if (!OLD_BANNERS.some((anchor) => head.includes(anchor))) continue
    removed.push(relative(dir, file).split("\\").join("/"))
    rmSync(file, { force: true })
  }
  // 自底向上删除空目录
  const pruneEmpty = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const full = join(current, entry.name)
      pruneEmpty(full)
      if (readdirSync(full).length === 0) rmSync(full, { recursive: true, force: true })
    }
  }
  pruneEmpty(dir)
  return removed.sort()
}

/**
 * 生成并校验单个配置。
 * 就地模式先复制备份旧产物，失败时恢复；成功后清理旧版横幅文件。
 * @param {string} configFile 配置绝对路径
 * @param {number} timeout 超时
 * @param {boolean} inPlace 是否就地执行
 * @return {{ok: boolean, messages: string[]}} 结果
 */
function generateConfig(configFile, timeout, inPlace = false) {
  const messages = []
  const outputs = outputsOf(configFile)
  const backupRoot = inPlace ? mkdtempSync(join(tmpdir(), "s2a-output-backup-")) : null
  const backups = outputs.map((dir, index) => {
    const existed = existsSync(dir)
    const backup = join(backupRoot ?? "", String(index))
    if (inPlace && existed) {
      cpSync(dir, backup, { recursive: true })
      messages.push(`备份产物：${dir}`)
    }
    return { dir, backup, existed }
  })
  if (!inPlace) {
    for (const dir of outputs) {
      rmSync(dir, { recursive: true, force: true })
      messages.push(`清空产物：${dir}`)
    }
  }
  /**
   * 收尾：成功删除备份并清理旧横幅，失败恢复原产物。
   * @param {boolean} ok 是否成功
   * @param {string} note 结果说明
   * @return {{ok: boolean, messages: string[]}} 结果
   */
  const finish = (ok, note) => {
    if (inPlace) {
      if (ok) {
        for (const { dir } of backups) {
          const removed = removeStaleBannerFiles(dir)
          if (removed.length > 0) messages.push(`清理旧产物：${removed.join("、")}`)
        }
      } else {
        for (const { dir, backup, existed } of backups) {
          if (!existed) {
            rmSync(dir, { recursive: true, force: true })
            continue
          }
          if (existsSync(dir)) clearDirContents(dir)
          restoreDir(backup, dir)
        }
      }
      rmSync(backupRoot, { recursive: true, force: true })
    }
    return { ok, messages: [...messages, note] }
  }
  const generated = run(process.execPath, [cli, "--config", configFile, "--all"], { cwd: dirname(configFile), timeout })
  if (generated.status !== 0) return finish(false, `生成失败：${generated.output}`)
  const checked = run(process.execPath, [cli, "--config", configFile, "--all", "--check"], { cwd: dirname(configFile), timeout })
  if (checked.status !== 0) return finish(false, `校验失败：${checked.output}`)
  return finish(true, `生成与校验通过：${configFile}`)
}

/**
 * 探测单个地址是否可访问。
 * @param {string} url 地址
 * @return {Promise<boolean>} 是否可访问
 */
function probeOnce(url) {
  return new Promise((done) => {
    const client = url.startsWith("https:") ? https : http
    const request = client.get(url, { timeout: 5000, rejectUnauthorized: false }, (response) => {
      response.resume()
      done((response.statusCode ?? 500) < 500)
    })
    request.on("timeout", () => {
      request.destroy()
      done(false)
    })
    request.on("error", () => done(false))
  })
}

/**
 * 探测 URL 是否就绪：同时尝试 localhost、IPv4 与 IPv6 回环，覆盖不同监听形态。
 * @param {string} url 地址
 * @return {Promise<boolean>} 是否可访问
 */
async function probe(url) {
  const candidates = new Set([url, url.replace("//localhost:", "//127.0.0.1:"), url.replace("//localhost:", "//[::1]:")])
  for (const candidate of candidates) {
    if (await probeOnce(candidate)) return true
  }
  return false
}

/** 本次启动的开发服务进程 */
const children = []

/**
 * 结束本次启动的所有开发服务（含子进程）。
 * @return {void}
 */
function stopChildren() {
  for (const child of children) {
    if (child.pid === undefined) continue
    if (isWindows) run("taskkill", ["/pid", String(child.pid), "/T", "/F"], { cwd: toolRoot, timeout: 30000 })
    else process.kill(-child.pid, "SIGTERM")
  }
  children.length = 0
}

/**
 * 从开发服务输出中提取本地访问地址。
 * @param {string} output 输出文本
 * @return {string | null} 地址
 */
function localUrlOf(output) {
  // 开发工具的彩色输出会在端口中间插入 ANSI 转义码，先剥离再匹配
  const plain = output.replace(/\u001b\[[0-9;]*m/g, "")
  const matched = plain.match(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/)
  return matched ? matched[0] : null
}

/**
 * 启动开发服务并等待就绪；未提供 url 时从输出中提取本地地址。
 * @param {{name: string, command: string, url?: string}} item 开发项
 * @param {string} cwd 工作目录
 * @param {number} timeout 单条命令超时
 * @return {Promise<{ok: boolean, message: string}>} 结果
 */
async function smokeDev(item, cwd, timeout) {
  const child = spawn(item.command, { cwd, shell: true, detached: !isWindows, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  children.push(child)
  let output = ""
  const collect = (chunk) => {
    output = `${output}${chunk}`.slice(-8000)
  }
  child.stdout?.on("data", collect)
  child.stderr?.on("data", collect)
  const deadline = Date.now() + Math.min(timeout, 120000)
  let url = item.url ?? null
  while (Date.now() < deadline) {
    if (!url) url = localUrlOf(output)
    if (url && (await probe(url))) return { ok: true, message: `就绪：${url}` }
    if (child.exitCode !== null && child.exitCode !== 0) return { ok: false, message: `启动失败，退出码 ${child.exitCode}：${output.slice(-1000)}` }
    await new Promise((done) => setTimeout(done, 2000))
  }
  return { ok: false, message: `等待就绪超时${url ? `：${url}` : ""}：${output.slice(-1000)}` }
}

/**
 * 主流程。
 * @return {Promise<void>} 无
 */
async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`失败：${error.message}`)
    printHelp()
    process.exit(2)
  }
  if (args.help) {
    printHelp()
    return
  }
  if (!args.manifest) {
    console.error("失败：缺少 --manifest <清单>；先按 --help 的清单格式准备文件")
    process.exit(2)
  }
  if (!existsSync(cli)) {
    console.error("失败：未找到 dist/cli.js，需先执行 pnpm build:debug")
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(args.manifest, "utf8"))
  const repos = (manifest.repos ?? []).filter((repo) => !args.only || String(repo.name).includes(args.only))
  if (repos.length === 0) {
    console.error("失败：清单中没有可执行的仓库")
    process.exit(2)
  }
  const report = { tool: "swagger2api", phases: [...args.phases], repos: [] }
  let failed = 0
  for (const repo of repos) {
    const entry = { name: repo.name, path: repo.path, ok: true, inPlace: args.inPlace, steps: [] }
    const paths = args.inPlace ? { worktree: repo.path, base: null } : createWorktree(repo.path)
    entry.worktree = paths.worktree
    try {
      if (args.phases.has("generate")) {
        for (const config of repo.configs ?? []) {
          const configFile = isAbsolute(config) ? config : join(paths.worktree, config)
          const result = generateConfig(configFile, args.timeout, args.inPlace)
          entry.steps.push({ phase: "generate", config, ok: result.ok, messages: result.messages })
          if (!result.ok) entry.ok = false
        }
      }
      if (args.phases.has("build")) {
        for (const command of repo.builds ?? []) {
          const result = runShell(command, { cwd: paths.worktree, timeout: args.timeout })
          entry.steps.push({ phase: "build", command, ok: result.status === 0, output: result.output.slice(-4000) })
          if (result.status !== 0) entry.ok = false
        }
      }
      if (args.phases.has("smoke")) {
        for (const item of repo.dev ?? []) {
          const result = await smokeDev(item, paths.worktree, args.timeout)
          entry.steps.push({ phase: "smoke", name: item.name, ok: result.ok, message: result.message })
          if (!result.ok) entry.ok = false
          // 逐个启动、验证后立即结束，避免同仓多端争用同一端口
          stopChildren()
        }
      }
    } finally {
      stopChildren()
      if (!entry.ok) failed += 1
      if (args.inPlace) {
        // 就地执行：不改动 worktree，只保留本次产物
      } else if (args.keep) console.log(`保留 worktree：${paths.worktree}`)
      else removeWorktree(repo.path, paths)
    }
    report.repos.push(entry)
    console.log(`${entry.ok ? "✔" : "✖"} ${repo.name}`)
    for (const step of entry.steps) {
      if (!step.ok) console.error(`  - ${step.phase}：${step.messages?.join("；") ?? step.output ?? step.message}`)
    }
  }
  const reportFile = join(toolRoot, "scripts", "business-validate.local-report.json")
  writeFileSync(reportFile, JSON.stringify(report, null, 2))
  if (args.json) console.log(JSON.stringify(report, null, 2))
  if (failed > 0) {
    console.error(`\n✖ 接入方验证未通过：${failed} 个仓库失败（报告：${reportFile}）`)
    process.exit(1)
  }
  console.log(`\n✔ 接入方验证通过：${repos.length} 个仓库（报告：${reportFile}）`)
}

main().catch((error) => {
  console.error(`失败：${error.stack ?? error.message}`)
  process.exit(1)
})
