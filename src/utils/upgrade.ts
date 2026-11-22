import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { askConfirm } from "./cli-ui"
import { CONFIG_LOCAL_FILE } from "./config"
import { canPrompt } from "./common"
import { argsToConfig, tokenizeArgs } from "./migrate"

// 一键迁移：发现旧配置与脚本，归一为新版 base + docs，备份后改写 package.json 与配置文件。
// 只做确定性映射；无法确定的内容列入人工项并阻断该项自动迁移。

/** 迁移选项 */
export interface UpgradeOptions {
  /** 扫描根目录 */
  cwd?: string
  /** 只输出计划 */
  dryRun?: boolean
  /** 输出差异 */
  diff?: boolean
  /** 只读复检 */
  check?: boolean
  /** 非交互执行 */
  yes?: boolean
  /** 只处理指定单元 */
  only?: string[]
  /** 跳过指定单元 */
  skip?: string[]
  /** 结构化输出 */
  json?: boolean
  /** 保留旧配置 */
  keepLegacy?: boolean
  /** 从备份恢复 */
  restore?: string
}

/**
 * 解析 upgrade 参数。
 * @param argv 参数列表
 * @return 选项
 */
export function parseUpgradeOptions(argv: string[] = process.argv.slice(2)): UpgradeOptions {
  const valueOf = (name: string) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const listOf = (name: string) => {
    const values: string[] = []
    argv.forEach((item, index) => {
      if (item === name) values.push(argv[index + 1] ?? "")
    })
    return [...new Set(values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))]
  }
  return {
    dryRun: argv.includes("--dry-run"),
    diff: argv.includes("--diff"),
    check: argv.includes("--check"),
    yes: argv.includes("--yes"),
    json: argv.includes("--json"),
    keepLegacy: argv.includes("--keep-legacy"),
    cwd: valueOf("--cwd"),
    restore: valueOf("--restore"),
    only: listOf("--only"),
    skip: listOf("--skip")
  }
}

/** 单个迁移单元 */
interface UpgradeUnit {
  /** 目录绝对路径 */
  dir: string
  /** 相对扫描根 */
  rel: string
  /** 现有项目配置 */
  project: string | null
  /** 本地层配置 */
  local: string | null
  /** 旧配置 */
  legacy: string[]
  /** 最近的 package.json */
  packageFile: string | null
}

/** 文件变更 */
interface FileChange {
  /** 相对扫描根路径 */
  path: string
  /** 变更前内容（不存在为 null） */
  before: string | null
  /** 变更后内容（删除为 null） */
  after: string | null
  /** 变更原因 */
  reason: string
}

/** 人工确认项 */
interface ManualItem {
  /** 相对路径 */
  path: string
  /** 原因 */
  reason: string
}

/** 迁移计划 */
interface UpgradePlan {
  /** 单元 */
  units: Array<{ rel: string; docs: string[]; packageFile: string | null }>
  /** 文件变更 */
  changes: FileChange[]
  /** 人工项 */
  manual: ManualItem[]
  /** 只读复检问题 */
  issues: string[]
  /** 已规范 */
  upToDate: boolean
}

/** 备份清单 */
interface BackupManifest {
  /** 创建时间 */
  created: string
  /** 变更前存在的文件（相对扫描根） */
  files: string[]
  /** 迁移新增的文件（恢复时删除） */
  createdFiles: string[]
}

/** 递归时跳过的目录 */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".swagger2api", ".vitepress"])

/**
 * 判断普通对象。
 * @param value 任意值
 * @return 是否普通对象
 */
function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * 统一相对路径分隔符。
 * @param value 路径
 * @return posix 形式
 */
function toPosix(value: string) {
  return value.split(path.sep).join("/")
}

/**
 * 深合并：对象递归，数组整体替换。
 * @param base 底层
 * @param overlay 覆盖层
 * @return 合并结果
 */
function mergeDeep(base: unknown, overlay: unknown): any {
  if (!isPlainObject(base)) return overlay === undefined ? overlay : structuredClone(overlay)
  const result: Record<string, any> = structuredClone(base)
  if (!isPlainObject(overlay)) return result
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? mergeDeep(result[key], value) : structuredClone(value)
  }
  return result
}

/**
 * 判断旧配置文件。
 * @param name 文件名
 * @return 是否旧配置
 */
function isLegacyFile(name: string) {
  return /^saconfig.*\.json$/i.test(name) || /^\.swagger2apirc.*\.json$/i.test(name)
}

/**
 * 旧文件对应的文档 id。
 * @param file 文件路径
 * @return 文档 id
 */
function legacyId(file: string) {
  const name = path.basename(file)
  if (name.startsWith(".swagger2apirc")) return "main"
  const id = name
    .replace(/\.json$/i, "")
    .replace(/^saconfig/i, "")
    .replace(/^[._-]+/, "")
    .trim()
  return id || "main"
}

/**
 * 读取 JSON 文件。
 * @param file 文件路径
 * @return 解析结果；失败返回 null
 */
function readJson(file: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 读取文本文件。
 * @param file 文件路径
 * @return 内容；不存在返回 null
 */
function readText(file: string) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null
}

/**
 * 递归列出文件（跳过依赖与产物目录）。
 * @param root 根目录
 * @return 绝对路径列表
 */
function listFiles(root: string) {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(path.join(dir, entry.name))
      } else if (entry.isFile()) {
        files.push(path.join(dir, entry.name))
      }
    }
  }
  walk(root)
  return files
}

/**
 * 从目录向上找最近的 package.json。
 * @param dir 起始目录
 * @param root 扫描根
 * @return 绝对路径或 null
 */
function nearestPackage(dir: string, root: string) {
  let current = path.resolve(dir)
  const limit = path.resolve(root)
  while (true) {
    const candidate = path.join(current, "package.json")
    if (fs.existsSync(candidate)) return candidate
    if (current === limit) break
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return fs.existsSync(path.join(limit, "package.json")) ? path.join(limit, "package.json") : null
}

/**
 * 发现迁移单元：有配置文件的目录各自成档。
 * @param root 扫描根
 * @return 单元列表与仓库内 package.json
 */
function discover(root: string) {
  const dirs = new Map<string, UpgradeUnit>()
  const packages = new Set<string>()
  for (const file of listFiles(root)) {
    const name = path.basename(file)
    if (name === "package.json") {
      packages.add(file)
      continue
    }
    if (name === "swagger2api.json" || name === "swagger2api.local.json" || isLegacyFile(name)) {
      const dir = path.dirname(file)
      const rel = toPosix(path.relative(root, dir)) || "."
      const unit = dirs.get(dir) ?? { dir, rel, project: null, local: null, legacy: [], packageFile: null }
      if (name === "swagger2api.json") unit.project = file
      else if (name === "swagger2api.local.json") unit.local = file
      else unit.legacy.push(file)
      dirs.set(dir, unit)
    }
  }
  for (const unit of dirs.values()) {
    unit.legacy.sort()
    unit.packageFile = nearestPackage(unit.dir, root)
  }
  return { units: [...dirs.values()].sort((left, right) => left.rel.localeCompare(right.rel)), packages: [...packages].sort() }
}

/**
 * client / language 对象收敛为字符串简写，递归处理预设。
 * @param config 配置
 * @return 转换后的配置
 */
function normalizeShorthand(config: Record<string, any>) {
  const result = structuredClone(config)
  if (isPlainObject(result.client) && typeof result.client.type === "string") result.client = result.client.type
  if (isPlainObject(result.language) && typeof result.language.target === "string") result.language = result.language.target
  if (isPlainObject(result.profiles)) {
    for (const [key, value] of Object.entries(result.profiles)) {
      if (isPlainObject(value)) result.profiles[key] = normalizeShorthand(value)
    }
  }
  return result
}

/**
 * 提取输入来源：input 或根级 url / file。
 * @param config 配置
 * @return source 或 undefined
 */
function pickSource(config: Record<string, any>) {
  if (config.source !== undefined) return config.source
  if (isPlainObject(config.input)) return structuredClone(config.input)
  if (typeof config.url === "string") return { url: config.url }
  if (typeof config.file === "string") return { file: config.file }
  return undefined
}

/**
 * 提取输出目录。
 * @param output 输出配置
 * @return 目录字符串或 undefined
 */
function pickOutputDir(output: unknown) {
  if (typeof output === "string") return output
  if (isPlainObject(output) && typeof output.dir === "string") return output.dir
  return undefined
}

/**
 * 输出选项（不含目录）。
 * @param output 输出配置
 * @return 选项对象
 */
function pickOutputOptions(output: unknown) {
  if (!isPlainObject(output)) return {}
  const result = structuredClone(output)
  delete result.dir
  return result
}

/**
 * 扁平配置转为 base + 单个文档。
 * @param config 旧配置
 * @param id 文档 id
 * @param fallbackOutput 兜底输出目录
 * @return base、文档与是否缺少输入
 */
function flatToParts(config: Record<string, any>, id: string, fallbackOutput = "./src/api") {
  let source = pickSource(config)
  const outputDir = pickOutputDir(config.output) ?? fallbackOutput
  const outputOptions = pickOutputOptions(config.output)
  const rest = structuredClone(config)
  for (const key of ["input", "source", "url", "file", "output", "name", "mode", "typeCheck", "timeout"]) delete rest[key]
  // 旧扁平别名并入对应段，避免写进 base 根
  const types = isPlainObject(rest.types) ? rest.types : {}
  for (const key of ["responses", "extractResponseRaw"]) {
    if (rest[key] !== undefined) types[key] = rest[key]
    delete rest[key]
  }
  if (rest.query !== undefined) {
    types.extractQuery = Array.isArray(rest.query) ? rest.query.join(",") : rest.query
    delete rest.query
  }
  if (Object.keys(types).length > 0) rest.types = types
  const naming = isPlainObject(rest.naming) ? rest.naming : {}
  for (const key of ["pathPrefixIndex", "convertGetToQuery", "dropPathParams", "tagRewrite"]) {
    if (rest[key] !== undefined) naming[key] = rest[key]
    delete rest[key]
  }
  if (Object.keys(naming).length > 0) rest.naming = naming
  if (config.typeCheck !== undefined) outputOptions.typeCheck = config.typeCheck
  if (config.timeout !== undefined) {
    if (isPlainObject(source)) source = { ...source, timeout: config.timeout }
    else if (typeof source === "string") source = /^https?:\/\//i.test(source) ? { url: source, timeout: config.timeout } : { file: source, timeout: config.timeout }
  }
  const base = normalizeShorthand(rest)
  const baseOutput = { ...pickOutputOptions(base.output), ...outputOptions }
  delete base.output
  if (typeof config.name === "string" && baseOutput.name === undefined) baseOutput.name = config.name
  if (typeof config.mode === "string" && baseOutput.mode === undefined) baseOutput.mode = config.mode
  if (Object.keys(baseOutput).length) base.output = baseOutput
  const doc: Record<string, any> = { id, output: outputDir }
  if (source !== undefined) doc.source = source
  return { base, doc, missingSource: source === undefined }
}

/**
 * 旧扁平写法转为文档项：别名并入 types / naming，输出选项并入 output。
 * @param raw 旧配置片段
 * @param id 文档 id
 * @param fallbackSource 兜底输入
 * @param fallbackOutput 兜底输出目录
 * @return 文档项
 */
function docFromFlat(raw: Record<string, any>, id: string, fallbackSource: unknown, fallbackOutput: string) {
  const parts = flatToParts(raw, id, fallbackOutput)
  const doc: Record<string, any> = { id, output: parts.doc.output }
  const source = parts.doc.source ?? fallbackSource
  if (source !== undefined) doc.source = source
  const fields = { ...parts.base }
  const outputOptions = isPlainObject(fields.output) ? fields.output : undefined
  delete fields.output
  Object.assign(doc, fields)
  if (outputOptions && Object.keys(outputOptions).length) {
    doc.output = typeof doc.output === "string" ? { dir: doc.output, ...outputOptions } : { ...(isPlainObject(doc.output) ? doc.output : {}), ...outputOptions }
  }
  return doc
}

/**
 * 把旧版 defaults + targets 或根级单文档转为新结构。
 * @param config 现有配置
 * @param fallbackId 单文档兜底 id
 * @return base、docs、profiles
 */
function convertExisting(config: Record<string, any>, fallbackId: string) {
  const profiles = isPlainObject(config.profiles) ? normalizeShorthand(config.profiles) : undefined
  if (Array.isArray(config.docs)) {
    const base = normalizeShorthand(isPlainObject(config.base) ? config.base : {})
    const docs = config.docs.map((raw: Record<string, any>) => {
      if (!isPlainObject(raw)) return raw
      const doc = structuredClone(raw)
      if (doc.source === undefined && isPlainObject(doc.input)) {
        doc.source = doc.input
        delete doc.input
      }
      if (doc.source === undefined && typeof doc.url === "string") {
        doc.source = { url: doc.url }
        delete doc.url
      }
      if (doc.source === undefined && typeof doc.file === "string") {
        doc.source = { file: doc.file }
        delete doc.file
      }
      return normalizeShorthand(doc)
    })
    return { base, docs, profiles }
  }

  const defaults = isPlainObject(config.defaults) ? structuredClone(config.defaults) : {}
  const targets = Array.isArray(config.targets) ? config.targets : []
  const fallbackSource = pickSource(defaults) ?? pickSource(config)
  const fallbackOutput = pickOutputDir(defaults.output) ?? pickOutputDir(config.output) ?? "./src/api"
  // defaults 先按扁平别名归一，保证 base 只保留嵌套段
  const base = flatToParts(defaults, "seed", fallbackOutput).base
  const rootOutput = { ...(isPlainObject(base.output) ? base.output : {}), ...pickOutputOptions(config.output) }
  if (typeof config.name === "string") rootOutput.name = config.name
  if (Object.keys(rootOutput).length > 0) base.output = rootOutput
  else delete base.output

  const docs: Array<Record<string, any>> = []
  if (targets.length > 0) {
    targets.forEach((raw: Record<string, any>, index) => {
      if (!isPlainObject(raw)) return
      const rest = structuredClone(raw)
      const id = typeof rest.id === "string" && rest.id.trim() ? rest.id.trim() : `doc${index + 1}`
      delete rest.id
      docs.push(docFromFlat(rest, id, fallbackSource, fallbackOutput))
    })
  } else {
    docs.push(docFromFlat(config, fallbackId, fallbackSource, fallbackOutput))
  }
  return { base, docs, profiles }
}

/**
 * 合并文档：同 id 深合并，否则追加。
 * @param docs 文档列表
 * @param doc 文档
 * @return 无
 */
function upsertDoc(docs: Array<Record<string, any>>, doc: Record<string, any>) {
  const index = docs.findIndex((item) => item.id === doc.id)
  if (index === -1) docs.push(doc)
  else docs[index] = mergeDeep(docs[index], doc)
}

/**
 * 判断脚本是否为生成类。
 * @param name 脚本名
 * @return 是否生成类
 */
function isGenerateScript(name: string) {
  return name === "api" || name.startsWith("api:")
}

/**
 * 脚本里是否含环境变量赋值、复合命令或位置参数。
 * @param command 命令
 * @return 是否含人工项
 */
function hasManualShell(command: string) {
  return /&&|\|\||\s\w+=\S+/.test(command) || /(^|\s)\$1(\s|$)/.test(command)
}

/**
 * 从命令中提取 swagger2api 之后的参数。
 * @param command 命令
 * @return 参数列表
 */
function argsAfterCli(command: string) {
  const tokens = tokenizeArgs(command)
  const start = tokens.findIndex((token) => token === "swagger2api" || token.endsWith("/swagger2api") || token.endsWith("\\swagger2api"))
  return start === -1 ? [] : tokens.slice(start + 1)
}

/**
 * 判断是否为非生成子命令。
 * @param args 参数
 * @return 是否跳过
 */
function isOtherCommand(args: string[]) {
  const command = args.find((arg) => !arg.startsWith("-"))
  return ["grouping", "skill", "config", "inspect", "prune", "surface", "upgrade"].includes(command ?? "")
}

/**
 * 脚本参数落到 base / 指定文档。
 * @param base 共享配置
 * @param doc 目标文档（可为空）
 * @param args 参数
 * @return 无
 */
function applyScriptArgs(base: Record<string, any>, doc: Record<string, any> | null, args: string[]) {
  const { config } = argsToConfig(args)
  const { base: argBase, doc: argDoc } = flatToParts(config, doc?.id ?? "main", pickOutputDir(doc?.output) ?? "./src/api")
  // 共享口径脚本优先；输入输出只落到目标文档
  for (const [key, value] of Object.entries(argBase)) {
    if (key === "output") {
      base.output = mergeDeep(base.output ?? {}, value)
      continue
    }
    base[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeDeep(base[key], value) : structuredClone(value)
  }
  if (!doc) return
  // 只有脚本显式给出的输入输出才覆盖文档项，避免 fallback 值冲掉已有配置
  const explicitSource = pickSource(config)
  const explicitOutput = pickOutputDir(config.output)
  if (explicitSource !== undefined) doc.source = mergeDeep(doc.source ?? {}, explicitSource)
  if (explicitOutput !== undefined) {
    const current = isPlainObject(doc.output) ? doc.output : {}
    doc.output = { ...current, dir: explicitOutput }
  }
  if (isPlainObject(argBase.output)) {
    const name = argBase.output.name
    if (name && typeof doc.output === "string") doc.output = { dir: doc.output, name }
    else if (name) doc.output = { ...(isPlainObject(doc.output) ? doc.output : {}), name }
  }
}

/**
 * 分析单个单元，产出配置、脚本与人工项。
 * @param unit 单元
 * @param keepLegacy 是否保留旧配置
 * @return 变更与人工项
 */
function analyzeUnit(unit: UpgradeUnit, keepLegacy: boolean) {
  const changes: FileChange[] = []
  const manual: ManualItem[] = []
  const relOf = (file: string) => toPosix(path.relative(unit.dir, file)) || "."
  let base: Record<string, any> = {}
  let docs: Array<Record<string, any>> = []
  let profiles: Record<string, any> | undefined

  if (unit.project) {
    const existing = readJson(unit.project)
    if (!existing) {
      manual.push({ path: relOf(unit.project), reason: "配置解析失败，跳过该目录" })
      return { changes, manual, docs: [] as string[] }
    }
    const converted = convertExisting(existing, "main")
    base = converted.base
    docs = converted.docs.filter(isPlainObject)
    profiles = converted.profiles
  }

  // 旧配置逐文件转换为文档
  for (const file of unit.legacy) {
    if (path.basename(file) === ".swagger2apirc.local.json") continue
    const legacy = readJson(file)
    if (!legacy) {
      manual.push({ path: relOf(file), reason: "旧配置解析失败，未自动迁移" })
      continue
    }
    const parts = flatToParts(legacy, legacyId(file))
    if (parts.missingSource) {
      manual.push({ path: relOf(file), reason: "旧配置缺少输入地址，未自动迁移" })
      continue
    }
    // 旧配置的个性化设置留在对应文档项，不提升到 base 影响其他文档
    upsertDoc(docs, docFromFlat(legacy, legacyId(file), undefined, "./src/api"))
  }

  // 本地层按 id 合并或追加，并改写为新结构后保留文件
  if (unit.local) {
    const local = readJson(unit.local)
    if (local) {
      let localConfig: Record<string, any>
      if (Array.isArray(local.docs)) {
        localConfig = { docs: local.docs.filter(isPlainObject).map((doc) => normalizeShorthand(structuredClone(doc))) }
        for (const doc of localConfig.docs) upsertDoc(docs, doc)
      } else {
        const localDoc = docFromFlat(local, docs.length === 1 ? docs[0].id : "local", undefined, pickOutputDir(local.output) ?? "./src/api")
        // 单文档时按 id 合并，仅覆盖输出等字段不会清掉已有输入
        upsertDoc(docs, localDoc)
        localConfig = { docs: [localDoc] }
      }
      const content = `${JSON.stringify(localConfig, null, 2)}\n`
      const before = readText(unit.local)
      if (before !== content) changes.push({ path: unit.local, before, after: content, reason: "本地层改为新结构" })
    }
  }

  // 脚本参数与收编：先判定全部生成脚本，存在人工项时保留原脚本，避免部分迁移
  let packageAfter: Record<string, any> | null = null
  if (unit.packageFile) {
    const pkg = readJson(unit.packageFile)
    if (pkg) {
      const scripts = isPlainObject(pkg.scripts) ? { ...pkg.scripts } : {}
      const checks: string[] = []
      const generated: Array<{ name: string; args: string[] }> = []
      let blocked = false
      for (const [name, command] of Object.entries(scripts)) {
        if (typeof command !== "string" || !command.includes("swagger2api")) continue
        if (!isGenerateScript(name)) continue
        const args = argsAfterCli(command)
        if (isOtherCommand(args)) continue
        if (args.includes("--check")) {
          checks.push(name)
          continue
        }
        if (hasManualShell(command)) {
          manual.push({ path: relOf(unit.packageFile), reason: `脚本 ${name} 含环境变量 / 复合命令 / 位置参数，未自动迁移` })
          blocked = true
          continue
        }
        const { unknown } = argsToConfig(args)
        if (unknown.length > 0) {
          manual.push({ path: relOf(unit.packageFile), reason: `脚本 ${name} 含未识别参数 ${unknown.join("、")}，未自动迁移` })
          blocked = true
          continue
        }
        generated.push({ name, args })
      }
      // 检查脚本始终删除；生成脚本仅在无人工项时收编
      for (const name of checks) delete scripts[name]
      if (!blocked && generated.length > 0) {
        for (const item of generated) {
          const suffix = item.name === "api" ? "" : item.name.slice(4)
          const target = suffix ? docs.find((doc) => doc.id === suffix) ?? null : docs.length === 1 ? docs[0] : null
          applyScriptArgs(base, target, item.args)
          delete scripts[item.name]
        }
        scripts.api = "swagger2api"
      }
      if (JSON.stringify(scripts) !== JSON.stringify(pkg.scripts)) {
        packageAfter = { ...pkg, scripts }
      }
    }
  }

  // 规范化配置
  if (!isPlainObject(base)) base = {}
  delete base.source
  if (isPlainObject(base.output)) {
    delete base.output.dir
    if (Object.keys(base.output).length === 0) delete base.output
  }
  docs = docs.filter(isPlainObject)
  const seenIds = new Set<string>()
  const outputDirs: Array<{ id: string; dir: string }> = []
  for (const doc of docs) {
    const id = typeof doc.id === "string" ? doc.id.trim() : ""
    if (!id) {
      manual.push({ path: unit.rel, reason: "存在缺少 id 的文档，未自动迁移" })
      continue
    }
    if (seenIds.has(id)) {
      manual.push({ path: unit.rel, reason: `文档 id 重复：${id}` })
      continue
    }
    seenIds.add(id)
    if (doc.source === undefined) {
      manual.push({ path: unit.rel, reason: `文档 ${id} 缺少输入，未自动迁移` })
      continue
    }
    const output = pickOutputDir(doc.output)
    if (!output) {
      manual.push({ path: unit.rel, reason: `文档 ${id} 缺少输出目录，未自动迁移` })
      continue
    }
    outputDirs.push({ id, dir: path.resolve(unit.dir, output) })
  }
  // 单文档：共享口径提升到 base，文档项只留输入与输出目录
  if (docs.length === 1) {
    const doc = docs[0]
    const { id: _id, source: _source, output, ...fields } = doc
    base = mergeDeep(fields, base)
    for (const key of Object.keys(fields)) delete doc[key]
    const outputOptions = isPlainObject(output) ? structuredClone(output) : { dir: output }
    const dir = outputOptions.dir
    delete outputOptions.dir
    const mergedOptions = mergeDeep(outputOptions, isPlainObject(base.output) ? base.output : {})
    if (Object.keys(mergedOptions).length > 0) base.output = mergedOptions
    doc.output = dir
  }

  for (let left = 0; left < outputDirs.length; left += 1) {
    for (let right = left + 1; right < outputDirs.length; right += 1) {
      const first = outputDirs[left]
      const second = outputDirs[right]
      const a = path.relative(first.dir, second.dir)
      const b = path.relative(second.dir, first.dir)
      if (a === "" || b === "" || (!a.startsWith("..") && !path.isAbsolute(a)) || (!b.startsWith("..") && !path.isAbsolute(b))) {
        manual.push({ path: unit.rel, reason: `文档 ${first.id} 与 ${second.id} 的输出目录重叠` })
      }
    }
  }

  if (docs.length > 0) {
    const config: Record<string, any> = { base, docs }
    if (profiles && Object.keys(profiles).length > 0) config.profiles = profiles
    const content = `${JSON.stringify(config, null, 2)}\n`
    const file = unit.project ?? path.join(unit.dir, "swagger2api.json")
    const before = readText(file)
    if (before !== content) changes.push({ path: file, before, after: content, reason: "写入新版配置" })
  }
  if (packageAfter && unit.packageFile) {
    const content = `${JSON.stringify(packageAfter, null, 2)}\n`
    const before = readText(unit.packageFile)
    if (before !== content) changes.push({ path: unit.packageFile, before, after: content, reason: "收编生成脚本" })
  }
  if (!keepLegacy) {
    for (const file of unit.legacy) changes.push({ path: file, before: readText(file), after: null, reason: "删除旧配置" })
  }
  return { changes, manual, docs: docs.map((doc) => String(doc.id ?? "?")) }
}

/**
 * 行级差异（LCS），只用于展示。
 * @param before 旧内容
 * @param after 新内容
 * @return 差异行
 */
export function lineDiff(before: string, after: string) {
  const left = before.split(/\r?\n/)
  const right = after.split(/\r?\n/)
  const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0))
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const lines: string[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push(` ${left[i]}`)
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push(`-${left[i]}`)
      i += 1
    } else {
      lines.push(`+${right[j]}`)
      j += 1
    }
  }
  while (i < left.length) lines.push(`-${left[i++]}`)
  while (j < right.length) lines.push(`+${right[j++]}`)
  return lines
}

/**
 * 计算文件哈希。
 * @param content 内容
 * @return sha256
 */
function hash(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

/**
 * 写入备份。
 * @param root 扫描根
 * @param changes 文件变更
 * @return 备份目录
 */
function backup(root: string, changes: FileChange[]) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)
  const dir = path.join(root, ".swagger2api", "backup", stamp)
  fs.mkdirSync(dir, { recursive: true })
  const manifest: BackupManifest = {
    created: new Date().toISOString(),
    files: [],
    createdFiles: changes.filter((change) => change.before === null && change.after !== null).map((change) => change.path)
  }
  for (const change of changes) {
    if (change.before === null) continue
    const target = path.join(dir, change.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, change.before)
    manifest.files.push(change.path)
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify({ ...manifest, hashes: Object.fromEntries(changes.filter((c) => c.before !== null).map((c) => [c.path, hash(c.before as string)])) }, null, 2)}\n`)
  return dir
}

/**
 * 写入受管 .gitignore 片段：备份目录与本地层配置不入库。
 * @param root 扫描根
 * @return 无
 */
function ensureGitignore(root: string) {
  const marker = "# @fxri/swagger2api"
  const rows = [`${marker} 个人配置与迁移备份不入库`, CONFIG_LOCAL_FILE, ".swagger2api/backup/"]
  const file = path.join(root, ".gitignore")
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  if (!existing.includes(marker)) {
    const content = existing && !existing.endsWith("\n") ? `${existing}\n` : existing
    fs.writeFileSync(file, `${content}${rows.join("\n")}\n`)
    return
  }
  const missing = rows.slice(1).filter((row) => !existing.includes(row))
  if (missing.length === 0) return
  const eol = existing.includes("\r\n") ? "\r\n" : "\n"
  const lines = existing.split(/\r?\n/)
  const index = lines.findIndex((line) => line.includes(marker))
  lines.splice(index + 1, 0, ...missing)
  fs.writeFileSync(file, lines.join(eol))
}

/**
 * 从备份恢复。
 * @param root 扫描根
 * @param target latest 或备份目录
 * @return 恢复的文件数
 */
function restoreBackup(root: string, target: string) {
  const base = path.join(root, ".swagger2api", "backup")
  let dir = target === "latest" ? null : path.resolve(root, target)
  if (!dir) {
    if (!fs.existsSync(base)) throw new Error("没有可用的备份")
    const entries = fs.readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    if (entries.length === 0) throw new Error("没有可用的备份")
    dir = path.join(base, entries[entries.length - 1])
  }
  const manifest = readJson(path.join(dir, "manifest.json")) as BackupManifest | null
  if (!manifest) throw new Error(`备份清单不存在：${path.join(dir, "manifest.json")}`)
  for (const file of manifest.createdFiles ?? []) fs.rmSync(path.join(root, file), { force: true })
  let count = 0
  for (const file of manifest.files ?? []) {
    const source = path.join(dir, file)
    if (!fs.existsSync(source)) continue
    const targetFile = path.join(root, file)
    fs.mkdirSync(path.dirname(targetFile), { recursive: true })
    fs.copyFileSync(source, targetFile)
    count += 1
  }
  return count
}

/**
 * 改写仓库内聚合脚本：`api:<id>` 引用改为内联目标，`api:check` 直接删除。
 * @param root 扫描根
 * @param packages 仓库内 package.json
 * @param unitPackages 已收编的单元 package.json
 * @param ids 已知文档 id
 * @return 变更与人工项
 */
function rewriteAggregates(root: string, packages: string[], unitPackages: Set<string>, ids: Set<string>) {
  const changes: FileChange[] = []
  const manual: ManualItem[] = []
  for (const file of packages) {
    if (unitPackages.has(file)) continue
    const pkg = readJson(file)
    if (!pkg) continue
    const scripts = isPlainObject(pkg.scripts) ? { ...pkg.scripts } : {}
    let changed = false
    for (const [name, command] of Object.entries(scripts)) {
      if (typeof command !== "string" || !command.includes("swagger2api")) continue
      if (command.includes("&&")) {
        manual.push({ path: toPosix(path.relative(root, file)), reason: `脚本 ${name} 含复合命令，未自动改写` })
        continue
      }
      if (/^\s*(?:npm|pnpm|yarn)\s+(?:run\s+)?api:check\s*$/.test(command)) {
        delete scripts[name]
        changed = true
        continue
      }
      if (name.startsWith("api:") && /\sapi\s*$/.test(command)) {
        const id = name.slice(4)
        if (ids.has(id)) {
          scripts[name] = command.replace(/\sapi\s*$/, ` swagger2api --target ${id}`)
          changed = true
          continue
        }
      }
      const next = command.replace(/\bapi:([A-Za-z0-9_-]+)\b/g, (match, id) => {
        if (name === `api:${id}`) return match
        return ids.has(id) ? `swagger2api --target ${id}` : match
      })
      if (next !== command) {
        scripts[name] = next
        changed = true
      }
    }
    if (changed) {
      const before = readText(file)
      const after = `${JSON.stringify({ ...pkg, scripts }, null, 2)}\n`
      if (before !== after) changes.push({ path: file, before, after, reason: "改写聚合脚本引用" })
    }
  }
  return { changes, manual }
}

/**
 * 复检旧资产。
 * @param units 单元
 * @param packages 仓库内 package.json
 * @return 问题列表
 */
function checkLegacy(units: UpgradeUnit[], packages: string[]) {
  const issues: string[] = []
  for (const unit of units) {
    for (const file of unit.legacy) issues.push(`旧配置文件：${toPosix(file)}`)
    if (unit.project) {
      const config = readJson(unit.project)
      if (config && !Array.isArray(config.docs)) issues.push(`旧 schema：${toPosix(unit.project)}（应为 base + docs）`)
    }
  }
  for (const file of packages) {
    const pkg = readJson(file)
    const scripts = isPlainObject(pkg?.scripts) ? pkg?.scripts : {}
    for (const [name, command] of Object.entries(scripts ?? {})) {
      if (typeof command !== "string" || !command.includes("swagger2api")) continue
      const tokens = tokenizeArgs(command)
      const direct = name === "api" ? command.trim() === "swagger2api" : tokens.includes("--target")
      if ((isGenerateScript(name) && !direct) || command.includes("api:check")) issues.push(`旧脚本：${toPosix(file)} → ${name}`)
      if (["--quick", "-q", "--config-all", "--config-scan"].some((flag) => tokens.includes(flag))) {
        issues.push(`旧参数：${toPosix(file)} → ${name}`)
      }
    }
  }
  const globalFile = path.join(os.homedir(), ".swagger2api.json")
  const global = readJson(globalFile)
  if (global && (global.docs !== undefined || ["url", "file", "input", "defaults", "targets"].some((key) => key in global) || global.base === undefined)) {
    issues.push(`全局层旧结构需人工检查：${globalFile}`)
  }
  return [...new Set(issues)]
}

/**
 * 输出计划。
 * @param plan 计划
 * @param options 选项
 * @return 无
 */
function printPlan(plan: UpgradePlan, options: UpgradeOptions) {
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: plan.manual.length === 0,
          units: plan.units,
          changes: plan.changes.map((change) => ({ path: change.path, action: change.after === null ? "delete" : change.before === null ? "create" : "update" })),
          manual: plan.manual,
          issues: plan.issues,
          upToDate: plan.upToDate
        },
        null,
        2
      )}\n`
    )
    return
  }
  if (plan.upToDate) {
    console.log("已是当前形态，无需迁移")
    return
  }
  console.log(`计划：${plan.units.length} 个目录 / ${plan.changes.length} 个文件变更`)
  plan.units.forEach((unit) => console.log(`  目录 ${unit.rel}：文档 ${unit.docs.join("、") || "无"}`))
  plan.changes.forEach((change) => console.log(`  ${change.after === null ? "删除" : change.before === null ? "新增" : "更新"}：${change.path}（${change.reason}）`))
  if (options.diff) {
    for (const change of plan.changes) {
      if (!change.before || !change.after) continue
      console.log(`\n--- ${change.path}`)
      lineDiff(change.before, change.after).forEach((line) => console.log(line))
    }
  }
  plan.manual.forEach((item) => console.error(`⚠️ 人工项：${item.path}：${item.reason}`))
  // 旧资产只在预览 / 复检时提示，实际写入阶段这些问题已随之消除
  if (options.dryRun || options.diff || options.check) plan.issues.forEach((issue) => console.error(`⚠️ 待处理：${issue}`))
}

/**
 * 执行迁移。
 * @param options 选项
 * @return 退出码
 */
export async function runUpgrade(options: UpgradeOptions = {}): Promise<number> {
  const root = path.resolve(options.cwd ?? process.cwd())
  if (!fs.existsSync(root)) {
    console.error(`失败：目录不存在：${root}`)
    return 2
  }
  if (options.restore) {
    try {
      const count = restoreBackup(root, options.restore)
      console.log(`已恢复 ${count} 个文件`)
      return 0
    } catch (error) {
      console.error(`失败：${(error as Error).message}`)
      return 1
    }
  }

  const found = discover(root)
  const selected = found.units.filter((unit) => {
    if (options.only?.length && !options.only.includes(unit.rel)) return false
    if (options.skip?.includes(unit.rel)) return false
    return true
  })
  if (options.only?.length) {
    const unknown = options.only.filter((id) => !found.units.some((unit) => unit.rel === id))
    if (unknown.length > 0) {
      console.error(`失败：未知迁移单元 ${unknown.join("、")}（可选：${found.units.map((unit) => unit.rel).join("、")}）`)
      return 2
    }
  }

  if (options.check) {
    const issues = checkLegacy(found.units, found.packages)
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok: issues.length === 0, issues }, null, 2)}\n`)
    } else if (issues.length === 0) {
      console.log("已是当前形态，无旧资产残留")
    } else {
      console.error(`✖ 发现 ${issues.length} 项旧资产：`)
      issues.forEach((issue) => console.error(`  - ${issue}`))
    }
    return issues.length === 0 ? 0 : 1
  }

  const collected: FileChange[] = []
  const manual: ManualItem[] = []
  const units: UpgradePlan["units"] = []
  for (const unit of selected) {
    const result = analyzeUnit(unit, Boolean(options.keepLegacy))
    collected.push(...result.changes)
    manual.push(...result.manual)
    units.push({ rel: unit.rel, docs: result.docs, packageFile: unit.packageFile ? toPosix(path.relative(root, unit.packageFile)) : null })
  }
  // 聚合脚本：仓库内其他 package.json 中的 api:<id> 引用改为内联目标
  const unitPackages = new Set(selected.map((unit) => unit.packageFile).filter((file): file is string => Boolean(file)))
  const knownIds = new Set(units.flatMap((unit) => unit.docs))
  const aggregate = rewriteAggregates(root, found.packages, unitPackages, knownIds)
  collected.push(...aggregate.changes)
  manual.push(...aggregate.manual)

  // 路径统一为扫描根相对路径，并按文件去重（同一 package.json 只保留最后一次结果）
  const changeMap = new Map<string, FileChange>()
  for (const change of collected) {
    changeMap.set(toPosix(path.relative(root, path.resolve(root, change.path))), change)
  }
  const changes = [...changeMap.values()].map((change) => ({
    ...change,
    path: toPosix(path.relative(root, path.resolve(root, change.path)))
  }))
  const issues = checkLegacy(found.units, found.packages)
  const upToDate = changes.length === 0 && manual.length === 0
  const plan: UpgradePlan = { units, changes, manual, issues, upToDate }

  if (options.dryRun || options.diff) {
    printPlan(plan, options)
    return manual.length > 0 ? 1 : 0
  }
  if (manual.length > 0) {
    printPlan(plan, options)
    console.error("✖ 存在未自动迁移项，已停止写入")
    return 1
  }
  if (upToDate) {
    printPlan(plan, options)
    return 0
  }
  if (!options.yes) {
    if (!canPrompt()) {
      console.error("失败：非交互环境执行 upgrade 需要 --yes")
      return 2
    }
    printPlan(plan, options)
    const confirmed = await askConfirm("确认应用以上变更?", false)
    if (!confirmed) {
      console.log("已取消")
      return 130
    }
  }

  // 备份在写入前完成；配置文件与 package.json 一并纳入
  const backupDir = backup(root, changes.filter((change) => change.before !== null || change.after !== null))
  for (const change of changes) {
    const file = path.resolve(root, change.path)
    if (change.after === null) fs.rmSync(file, { force: true })
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, change.after)
    }
  }
  ensureGitignore(root)
  printPlan(plan, options)
  console.log(`备份：${toPosix(path.relative(root, backupDir))}`)
  return 0
}
