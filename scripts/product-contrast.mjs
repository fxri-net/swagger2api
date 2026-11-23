import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"

// 双产物同源比对：同一份 swagger 快照，分别用旧版 CLI 与当前 CLI 生成产物，比较导出契约与业务调用点。
// 清单含本机路径，放 scripts/business-contrast.local.json（已被 .gitignore 忽略）。
// 旧 CLI 与两份产物全部落在系统临时目录，不修改接入方仓库。

const toolRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cli = join(toolRoot, "dist", "cli.js")
const require = createRequire(join(toolRoot, "package.json"))
const ts = require("typescript")
const workRoot = join(tmpdir(), "s2a-contrast")
const snapshotRoot = join(tmpdir(), "s2a-snapshots")
const legacyRoot = join(tmpdir(), "s2a-old-cli")

/** 展开深度：顶层符号 → 命名空间成员 → 方法签名 */
const MAX_DEPTH = 3
/** 单行阈值不影响比对，仅用于展示截断 */
const MAX_TEXT = 300

/**
 * 读取参数。
 * @param {string[]} argv 参数
 * @return {Record<string, any>} 解析结果
 */
function parseArgs(argv) {
  const result = { phases: new Set(), json: false, keep: false, timeout: 300000 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--manifest") result.manifest = argv[(index += 1)]
    else if (arg === "--only") result.only = argv[(index += 1)]
    else if (arg === "--timeout") result.timeout = Number(argv[(index += 1)])
    else if (arg === "--json") result.json = true
    else if (arg === "--keep") result.keep = true
    else if (arg === "--generate" || arg === "--compare") result.phases.add(arg.slice(2))
    else if (arg === "--all") ["generate", "compare"].forEach((phase) => result.phases.add(phase))
    else if (arg === "--help" || arg === "-h") result.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  if (result.phases.size === 0) ["generate", "compare"].forEach((phase) => result.phases.add(phase))
  return result
}

/** 输出帮助 */
function printHelp() {
  console.log(`用法：node scripts/product-contrast.mjs --manifest <清单> [阶段]

阶段（缺省 generate + compare）：
  --generate   用旧版 CLI 与当前 CLI 各生成一份产物（读同一份本地快照）
  --compare    比较导出契约与业务调用点，输出报告

选项：--only <关键词> / --timeout <毫秒> / --keep（保留临时目录）/ --json

清单（scripts/business-contrast.local.json，不入库）：
{
  "repos": [{
    "name": "接入方 A",
    "path": "D:/work/repo",
    "toolVersion": "1.1.13",
    "oldCommit": "<迁移提交的父提交>",
    "docs": [{ "id": "base", "snapshot": "a-base", "oldConfig": "apps/h5/base/saconfig.json",
               "newConfig": "apps/h5/base/swagger2api.json", "oldArgs": ["--quick", "--axios", "--responses", "-q"] }]
  }]
}`)
}

/**
 * 执行命令并返回结果。
 * @param {string} command 可执行文件
 * @param {string[]} args 参数
 * @param {string} cwd 工作目录
 * @param {number} timeout 超时
 * @param {boolean} shell 是否经 shell（Windows 下的 npm 需要）
 * @return {{status: number, output: string}}
 */
function run(command, args, cwd, timeout, shell = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout, shell })
  return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

/**
 * 判断普通对象。
 * @param {unknown} value 任意值
 * @return {boolean}
 */
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * 统一类型文本：去掉注释、标点空白与跨文件 import 前缀。
 * @param {string} text 文本
 * @return {string}
 */
function normalize(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/[;,]/g, " ")
    .replace(/([?:=([]\s*)\|/g, "$1")
    .replace(/\s*([()[\]{}<>|])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * 类型文本（去 import 前缀）。
 * @param {import("typescript").TypeChecker} checker 检查器
 * @param {import("typescript").Type} type 类型
 * @param {import("typescript").Node} node 节点
 * @return {string}
 */
function plain(checker, type, node) {
  return checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation).replace(/import\("[^"]*"\)\./g, "")
}

/**
 * 调用签名：忽略参数名。
 * @param {import("typescript").TypeChecker} checker 检查器
 * @param {import("typescript").Type} type 类型
 * @param {import("typescript").Node} node 节点
 * @return {string[]}
 */
function callSignatures(checker, type, node) {
  return type
    .getCallSignatures()
    .map((signature) => {
      const params = signature.getParameters().map((param) => plain(checker, checker.getTypeOfSymbolAtLocation(param, node), node))
      return normalize(`(${params.join(",")}) => ${plain(checker, signature.getReturnType(), node)}`)
    })
    .sort()
}

/**
 * 是否展开成员：只展开产物内的命名类型与内联对象。
 * @param {import("typescript").Type} type 类型
 * @param {number} depth 深度
 * @return {boolean}
 */
function shouldExpand(type, depth) {
  if (depth >= MAX_DEPTH) return false
  const declaration = type.getSymbol()?.declarations?.[0]
  if (!declaration) return false
  const file = declaration.getSourceFile().fileName
  return !file.includes("node_modules") && !file.includes("typescript/lib")
}

/**
 * 类型描述：联合排序、可展开的展开、其余文本。
 * @param {import("typescript").TypeChecker} checker 检查器
 * @param {import("typescript").Type} type 类型
 * @param {import("typescript").Node} node 节点
 * @param {number} depth 深度
 * @return {object}
 */
function describeType(checker, type, node, depth = 0) {
  if (type.isUnion?.()) return { text: type.types.map((item) => normalize(plain(checker, item, node))).sort().join("|") }
  const signatures = callSignatures(checker, type, node)
  if (signatures.length > 0) return { sigs: signatures }
  const properties = checker.getPropertiesOfType(type)
  if (properties.length > 0 && shouldExpand(type, depth)) {
    const props = {}
    for (const property of [...properties].sort((left, right) => left.name.localeCompare(right.name))) {
      props[property.name] = describeType(checker, checker.getTypeOfSymbolAtLocation(property, node), node, depth + 1)
    }
    return { props }
  }
  return { text: normalize(plain(checker, type, node)) }
}

/**
 * 提取目录入口的导出面。
 * @param {string} dir 产物目录
 * @return {object|{error: string}}
 */
function surfaceOf(dir) {
  const entry = ["index.d.ts", "index.ts", "index.js"].map((name) => join(dir, name)).find((file) => existsSync(file))
  if (!entry) return { error: `缺少入口：${dir}` }
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    skipLibCheck: true,
    noEmit: true,
    allowJs: false
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  const moduleSymbol = source ? (checker.getSymbolAtLocation(source) ?? source.symbol) : null
  if (!source || !moduleSymbol) return { error: `无法读取模块：${entry}` }
  const exports = {}
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    const decl = target.declarations?.[0]
    if (!decl) continue
    const name = symbol.getName()
    if (ts.isClassDeclaration(decl)) {
      exports[name] = { kind: "class", ...describeType(checker, checker.getDeclaredTypeOfSymbol(target), decl, 1) }
    } else if (ts.isEnumDeclaration(decl)) {
      exports[name] = { kind: "enum", members: decl.members.map((member) => member.name.getText(decl.getSourceFile())) }
    } else if (ts.isFunctionDeclaration(decl) || ts.isVariableDeclaration(decl)) {
      exports[name] = { kind: "value", ...describeType(checker, checker.getTypeAtLocation(decl), decl, 1) }
    } else {
      exports[name] = { kind: "type", ...describeType(checker, checker.getDeclaredTypeOfSymbol(target), decl, 1) }
    }
  }
  return { exports }
}

/**
 * 递归比较两个节点。
 * @param {string} label 路径
 * @param {object} before 旧
 * @param {object} after 新
 * @param {object} report 报告
 * @return {void}
 */
function compareNode(label, before, after, report) {
  if (JSON.stringify(before) === JSON.stringify(after)) return
  if (before.sigs && after.sigs) {
    if (JSON.stringify(before.sigs) !== JSON.stringify(after.sigs)) report.changed.push({ path: label, old: before.sigs.join(" | ").slice(0, MAX_TEXT), new: after.sigs.join(" | ").slice(0, MAX_TEXT) })
    return
  }
  if (before.props && after.props) {
    for (const key of Object.keys(before.props)) {
      if (!(key in after.props)) report.missing.push(`${label}.${key}`)
      else compareNode(`${label}.${key}`, before.props[key], after.props[key], report)
    }
    for (const key of Object.keys(after.props)) if (!(key in before.props)) report.added.push(`${label}.${key}`)
    return
  }
  report.changed.push({ path: label, old: JSON.stringify(before).slice(0, MAX_TEXT), new: JSON.stringify(after).slice(0, MAX_TEXT) })
}

/**
 * 比较两份导出面。
 * @param {object} before 旧
 * @param {object} after 新
 * @return {object}
 */
function compareSurface(before, after) {
  const report = { symbols: { old: 0, new: 0 }, missing: [], added: [], changed: [] }
  if (before.error || after.error) return { ...report, error: before.error ?? after.error }
  report.symbols = { old: Object.keys(before.exports).length, new: Object.keys(after.exports).length }
  for (const [name, value] of Object.entries(before.exports)) {
    if (!(name in after.exports)) report.missing.push(name)
    else compareNode(name, value, after.exports[name], report)
  }
  for (const name of Object.keys(after.exports)) if (!(name in before.exports)) report.added.push(name)
  return report
}

/** 需要跳过的目录 */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".swagger2api", ".turbo", ".output", ".quasar"])

/**
 * 递归收集业务源码文件（跳过产物目录）。
 * @param {string} dir 目录
 * @param {string[]} files 收集结果
 * @return {string[]}
 */
function walkSource(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name === "api" && dir.endsWith("src")) continue
      walkSource(join(dir, entry.name), files)
      continue
    }
    if (/\.(ts|tsx|js|jsx|vue|mjs)$/.test(entry.name)) files.push(join(dir, entry.name))
  }
  return files
}

/**
 * 从导出面取命名空间集合：类导出中 props 的对象成员。
 * @param {object} surface 导出面
 * @return {Set<string>}
 */
function namespacesOf(surface) {
  const names = new Set()
  if (surface.error) return names
  for (const value of Object.values(surface.exports)) {
    if (value.kind !== "class" || !value.props) continue
    for (const [key, member] of Object.entries(value.props)) if (member.props) names.add(key)
  }
  return names
}

/**
 * 提取业务调用点并判定新旧可用性。
 * @param {string} repoPath 仓库根
 * @param {Set<string>} namespaces 命名空间
 * @param {object} oldSurface 旧导出面
 * @param {object} newSurface 新导出面
 * @return {{checked: number, p0: object[], p1: object[]}}
 */
function compareCalls(repoPath, namespaces, oldSurface, newSurface) {
  const calls = new Map()
  for (const file of walkSource(repoPath)) {
    const text = readFileSync(file, "utf8")
    for (const match of text.matchAll(/\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!namespaces.has(match[1])) continue
      const key = `${match[1]}.${match[2]}`
      calls.set(key, (calls.get(key) ?? 0) + 1)
    }
  }
  const lookup = (surface, key) => {
    const [namespace, method] = key.split(".")
    for (const value of Object.values(surface.exports)) {
      if (value.kind !== "class" || !value.props) continue
      const member = value.props[namespace]
      if (!member?.props) continue
      if (method in member.props) return true
    }
    return false
  }
  const p0 = []
  const p1 = []
  for (const [key, count] of calls) {
    const oldHas = lookup(oldSurface, key)
    const newHas = lookup(newSurface, key)
    if (oldHas && !newHas) p0.push({ call: key, count })
    else if (!oldHas && newHas) p1.push({ call: key, count })
  }
  return { checked: calls.size, p0, p1 }
}

/**
 * 安装旧版 CLI 并返回入口。
 * @param {string} version 版本
 * @param {number} timeout 超时
 * @return {string}
 */
function ensureLegacyCli(version, timeout) {
  const dir = join(legacyRoot, version)
  const entry = join(dir, "node_modules/@fxri/swagger2api/dist/cli.js")
  if (existsSync(entry)) return entry
  mkdirSync(dir, { recursive: true })
  const installed = run("npm", ["install", `@fxri/swagger2api@${version}`, "--prefix", dir, "--no-save", "--no-audit", "--no-fund"], dir, timeout, process.platform === "win32")
  if (!existsSync(entry)) throw new Error(`旧版 CLI 安装失败（${version}）：${installed.output.slice(-800)}`)
  return entry
}

/**
 * 旧产物：旧配置改写为本地快照与临时输出后，用旧版 CLI 生成。
 * @param {object} repo 仓库
 * @param {object} doc 文档
 * @param {string} dir 工作目录
 * @param {number} timeout 超时
 * @return {string} 产物目录
 */
function generateLegacy(repo, doc, dir, timeout) {
  const oldDir = join(dir, "old")
  rmSync(oldDir, { recursive: true, force: true })
  mkdirSync(oldDir, { recursive: true })
  const text = run("git", ["-C", repo.path, "show", `${repo.oldCommit}:${doc.oldConfig}`], repo.path, timeout)
  if (text.status !== 0) throw new Error(`读取旧配置失败：${doc.oldConfig}`)
  const config = JSON.parse(text.output)
  config.url = join(snapshotRoot, `${doc.snapshot}.json`)
  config.output = oldDir
  const configFile = join(dir, "old-config.json")
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)
  const legacyCli = ensureLegacyCli(repo.toolVersion, timeout)
  const args = [legacyCli, "--config", configFile, ...doc.oldArgs.filter((item) => item !== "$1")]
  const result = run(process.execPath, args, dir, timeout)
  if (result.status !== 0) throw new Error(`旧产物生成失败：${result.output.slice(-800)}`)
  return oldDir
}

/**
 * 新产物：当前配置只保留目标文档，source 指向同一快照，输出到临时目录。
 * @param {object} repo 仓库
 * @param {object} doc 文档
 * @param {string} dir 工作目录
 * @param {number} timeout 超时
 * @return {string} 产物目录
 */
function generateCurrent(repo, doc, dir, timeout) {
  const newDir = join(dir, "new")
  rmSync(newDir, { recursive: true, force: true })
  mkdirSync(newDir, { recursive: true })
  const config = JSON.parse(readFileSync(join(repo.path, doc.newConfig), "utf8"))
  const target = (config.docs ?? []).find((item) => item.id === doc.id) ?? (config.docs ?? [])[0]
  if (!target) throw new Error(`新配置缺少文档：${doc.id}`)
  target.source = join(snapshotRoot, `${doc.snapshot}.json`)
  target.output = isObject(target.output) ? { ...target.output, dir: newDir } : newDir
  config.docs = [target]
  const configFile = join(dir, "new-config.json")
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)
  const result = run(process.execPath, [cli, "-c", configFile, "--all"], dir, timeout)
  if (result.status !== 0) throw new Error(`新产物生成失败：${result.output.slice(-800)}`)
  return newDir
}

/**
 * 主流程。
 * @return {Promise<void>}
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
    console.error("失败：缺少 --manifest <清单>")
    process.exit(2)
  }
  if (!existsSync(cli)) {
    console.error("失败：未找到 dist/cli.js，需先执行 pnpm build:debug")
    process.exit(1)
  }
  const manifest = JSON.parse(readFileSync(args.manifest, "utf8"))
  const repos = (manifest.repos ?? []).filter((repo) => !args.only || String(repo.name).includes(args.only))
  const report = { tool: "swagger2api", phases: [...args.phases], repos: [] }
  let failed = 0
  for (const repo of repos) {
    const entry = { name: repo.name, path: repo.path, toolVersion: repo.toolVersion, ok: true, docs: [] }
    for (const doc of repo.docs ?? []) {
      const dir = join(workRoot, `${basename(repo.path)}-${doc.id}`)
      const item = { id: doc.id, snapshot: doc.snapshot, ok: true }
      try {
        if (args.phases.has("generate")) {
          item.oldDir = generateLegacy(repo, doc, dir, args.timeout)
          item.newDir = generateCurrent(repo, doc, dir, args.timeout)
        } else {
          item.oldDir = join(dir, "old")
          item.newDir = join(dir, "new")
        }
        if (args.phases.has("compare")) {
          const oldSurface = surfaceOf(item.oldDir)
          const newSurface = surfaceOf(item.newDir)
          item.surface = compareSurface(oldSurface, newSurface)
          item.calls = compareCalls(repo.path, namespacesOf(oldSurface), oldSurface, newSurface)
          if (item.surface.error || item.calls.p0.length > 0) item.ok = false
        }
      } catch (error) {
        item.ok = false
        item.error = error.message
      }
      if (!item.ok) entry.ok = false
      entry.docs.push(item)
      console.log(`${item.ok ? "✔" : "✖"} ${repo.name} / ${doc.id}`)
      if (item.surface && !item.surface.error) {
        console.log(`  符号 ${item.surface.symbols.old} → ${item.surface.symbols.new}；缺失 ${item.surface.missing.length}、新增 ${item.surface.added.length}、变化 ${item.surface.changed.length}`)
      }
      if (item.calls) console.log(`  调用点 ${item.calls.checked} 个；P0 ${item.calls.p0.length}、P1 ${item.calls.p1.length}`)
      if (item.error) console.error(`  ${item.error}`)
      if (!args.keep && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
    if (!entry.ok) failed += 1
    report.repos.push(entry)
  }
  const reportFile = join(toolRoot, "scripts", "business-contrast.local-report.json")
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`)
  if (args.json) console.log(JSON.stringify(report, null, 2))
  if (failed > 0) {
    console.error(`\n✖ 同源比对未通过：${failed} 个仓库存在破坏性差异（报告：${reportFile}）`)
    process.exit(1)
  }
  console.log(`\n✔ 同源比对通过：${repos.length} 个仓库（报告：${reportFile}）`)
}

main().catch((error) => {
  console.error(`失败：${error.stack ?? error.message}`)
  process.exit(1)
})
