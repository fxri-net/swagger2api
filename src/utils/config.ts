import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// 配置分层：全局层 ~/.swagger2api.json（个人跨项目）、项目层 swagger2api.json（团队共享，向上查找）、
// 本地层 swagger2api.local.json（个人按项目，默认不入库）。旧名 .swagger2apirc*.json 继续可用，
// 同目录并存时新名优先并告警。合并粒度：全局→项目按段整体覆盖，项目→本地按段内字段浅合并（数组整体替换），
// 与同基地工具链的 rc 约定保持一致。
/** 项目层配置文件名 */
export const CONFIG_PROJECT_FILE = "swagger2api.json"
/** 项目层旧文件名（兼容） */
export const CONFIG_PROJECT_FILE_LEGACY = ".swagger2apirc.json"
/** 本地层配置文件名 */
export const CONFIG_LOCAL_FILE = "swagger2api.local.json"
/** 本地层旧文件名（兼容） */
export const CONFIG_LOCAL_FILE_LEGACY = ".swagger2apirc.local.json"
/** 全局层配置文件名（个人跨项目，隐藏文件） */
export const CONFIG_GLOBAL_FILE = ".swagger2api.json"
/** 全局层旧文件名（兼容） */
export const CONFIG_GLOBAL_FILE_LEGACY = ".swagger2apirc.json"

/** 层名 */
export type ConfigLayerName = "全局层" | "项目层" | "本地层"

/** 单层加载结果 */
export interface ConfigLayerRecord {
  /** 层名 */
  layer: ConfigLayerName
  /** 命中文件（未命中为 null） */
  file: string | null
  /** 文件存在且解析成功 */
  hit: boolean
  /** 该层写出的段名 */
  sections: string[]
  /** 原始配置 */
  config: Record<string, any> | null
}

/** 三层加载结果 */
export interface ConfigLayers {
  /** 全局层 */
  global: ConfigLayerRecord
  /** 项目层 */
  project: ConfigLayerRecord
  /** 本地层 */
  local: ConfigLayerRecord
  /** 合并结果 */
  merged: Record<string, any> | null
  /** 加载过程中的告警 */
  warnings: string[]
}

/**
 * 读取单个 rc 文件并解析。
 * @param file 绝对路径
 * @return 层记录
 */
function readLayer(file: string | null, layer: ConfigLayerName, warnings: string[]): ConfigLayerRecord {
  const empty: ConfigLayerRecord = { layer, file, hit: false, sections: [], config: null }
  if (!file || !fs.existsSync(file)) return empty
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      warnings.push(`${file}：根节点必须是对象，已忽略该层`)
      return { ...empty, hit: false }
    }
    return { layer, file, hit: true, sections: Object.keys(parsed), config: parsed }
  } catch (error) {
    warnings.push(`${file}：解析失败（${(error as Error).message}），已忽略该层`)
    return empty
  }
}

/**
 * 自起始目录向上查找最近的指定文件。
 * @param fileName 文件名
 * @param startDir 起始目录
 * @return 命中的绝对路径或 null
 */
export function findUpward(fileName: string, startDir: string) {
  let current = path.resolve(startDir)
  while (true) {
    const candidate = path.join(current, fileName)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * 按段合并：base 的段被 overlay 的同名段整体替换。
 * @param base 底层配置
 * @param overlay 覆盖层配置
 * @return 合并结果
 */
export function mergeSections(base: Record<string, any> | null, overlay: Record<string, any> | null) {
  if (!base) return overlay ? { ...overlay } : null
  if (!overlay) return { ...base }
  const merged: Record<string, any> = { ...base }
  for (const [section, value] of Object.entries(overlay)) {
    merged[section] = value
  }
  return merged
}

/**
 * 段内字段浅合并：本地层覆盖项目层同名字段，数组整体替换。
 * @param base 底层配置
 * @param overlay 覆盖层配置
 * @return 合并结果
 */
export function mergeShallow(base: Record<string, any> | null, overlay: Record<string, any> | null) {
  if (!base) return overlay ? { ...overlay } : null
  if (!overlay) return { ...base }
  const merged: Record<string, any> = { ...base }
  for (const [section, value] of Object.entries(overlay)) {
    const current = merged[section]
    merged[section] =
      current && typeof current === "object" && !Array.isArray(current) && value && typeof value === "object" && !Array.isArray(value)
        ? { ...current, ...value }
        : value
  }
  return merged
}

/**
 * 按「同目录新名优先、最近目录优先」查找配置文件。
 * @param names 文件名，按优先级排列（新名在前、旧名在后）
 * @param startDir 起始目录
 * @return 命中的文件与同目录被忽略的旧文件
 */
export function findLayerFile(names: string[], startDir: string) {
  const [primary, ...legacy] = names
  let current = path.resolve(startDir)
  while (true) {
    const primaryFile = path.join(current, primary)
    if (fs.existsSync(primaryFile)) {
      const ignored = legacy.map((name) => path.join(current, name)).find((file) => fs.existsSync(file)) ?? null
      return { file: primaryFile, ignored }
    }
    const fallback = legacy.map((name) => path.join(current, name)).find((file) => fs.existsSync(file))
    if (fallback) return { file: fallback, ignored: null }
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * 加载三层配置。
 * @param cwd 起始目录，默认当前工作目录
 * @param options.projectFile 显式指定的项目层文件（--config）
 * @param options.homeDir 全局层目录（测试可注入，默认用户主目录）
 * @return 三层加载结果
 */
export function loadConfigLayers(cwd = process.cwd(), options: { projectFile?: string; homeDir?: string } = {}): ConfigLayers {
  const warnings: string[] = []
  const home = options.homeDir ?? os.homedir()
  const globalNew = path.join(home, CONFIG_GLOBAL_FILE)
  const globalLegacy = path.join(home, CONFIG_GLOBAL_FILE_LEGACY)
  const globalPick = fs.existsSync(globalNew)
    ? { file: globalNew, ignored: fs.existsSync(globalLegacy) ? globalLegacy : null }
    : fs.existsSync(globalLegacy)
      ? { file: globalLegacy, ignored: null }
      : null
  const projectPick = options.projectFile
    ? { file: path.resolve(options.projectFile), ignored: null }
    : findLayerFile([CONFIG_PROJECT_FILE, CONFIG_PROJECT_FILE_LEGACY], cwd)
  const localPick = findLayerFile([CONFIG_LOCAL_FILE, CONFIG_LOCAL_FILE_LEGACY], cwd)
  // 同目录新旧并存：新名生效，旧文件提示清理，不静默
  for (const pick of [globalPick, projectPick, localPick]) {
    if (pick?.ignored) warnings.push(`${pick.file}：同时存在旧配置 ${pick.ignored}，已按新文件名生效，建议删除旧文件`)
  }
  const global = readLayer(globalPick?.file ?? null, "全局层", warnings)
  const project = readLayer(projectPick?.file ?? null, "项目层", warnings)
  const local = readLayer(localPick?.file ?? null, "本地层", warnings)
  const merged = mergeShallow(mergeSections(global.config, project.config), local.config)
  return { global, project, local, merged, warnings }
}

/** 环境变量覆盖表：唯一真源，config status 与文档共用 */
export const CONFIG_ENV_OVERRIDES: ReadonlyArray<{ env: string; key: string; type: "string" | "boolean" }> = [
  { env: "FX_S2A_INPUT", key: "input.url", type: "string" },
  { env: "FX_S2A_OUTPUT", key: "output.dir", type: "string" },
  { env: "FX_S2A_NAME", key: "output.name", type: "string" },
  { env: "FX_S2A_CLIENT", key: "client.type", type: "string" },
  { env: "FX_S2A_LANGUAGE", key: "language.target", type: "string" },
  { env: "FX_S2A_CLEAN", key: "output.clean", type: "boolean" },
]

/**
 * 按点号路径取值。
 * @param source 对象
 * @param keyPath 点号路径
 * @return 值或 undefined
 */
export function getByPath(source: any, keyPath: string) {
  return keyPath.split(".").reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), source)
}

/**
 * 按点号路径写值（不存在时自动建对象）。
 * @param target 对象
 * @param keyPath 点号路径
 * @param value 值
 * @return 无
 */
export function setByPath(target: Record<string, any>, keyPath: string, value: unknown) {
  const keys = keyPath.split(".")
  let current = target
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      current[key] = value
      return
    }
    if (!current[key] || typeof current[key] !== "object") current[key] = {}
    current = current[key]
  })
}

/**
 * 用环境变量覆盖配置。
 * @param config 基础配置
 * @param env 环境变量
 * @return 覆盖后的新配置
 */
export function applyEnvOverrides(config: Record<string, any> | null, env: Record<string, string | undefined> = process.env) {
  const result: Record<string, any> = config ? structuredClone(config) : {}
  for (const item of CONFIG_ENV_OVERRIDES) {
    const raw = env[item.env]
    if (raw === undefined || raw === "") continue
    setByPath(result, item.key, item.type === "boolean" ? !["0", "false"].includes(raw.toLowerCase()) : raw)
  }
  return result
}

/** 扁平配置中直接写在根上的字段 */
const FLAT_KEYS = [
  "url",
  "file",
  "name",
  "mode",
  "typeCheck",
  "responses",
  "query",
  "extractResponseRaw",
  "pathPrefixIndex",
  "convertGetToQuery",
  "dropPathParams",
  "tagRewrite"
]

/**
 * 归一化配置：根上出现 url / file 时按扁平格式解读，转成内部嵌套结构；
 * 原嵌套格式原样返回，保证旧配置继续可用。
 * @param config 原始配置
 * @return 归一化后的配置
 */
export function normalizeConfig(config: Record<string, any> | null): Record<string, any> {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {}
  if (typeof config.url !== "string" && typeof config.file !== "string") return config

  const result: Record<string, any> = { ...config }
  // 输入
  result.input = {
    ...(config.input && typeof config.input === "object" ? config.input : {}),
    ...(typeof config.url === "string" ? { url: config.url } : {}),
    ...(typeof config.file === "string" ? { file: config.file } : {})
  }
  // 输出：字符串即目录；分组模式默认开启清单清理
  const output: Record<string, any> = {
    ...(config.output && typeof config.output === "object" ? config.output : {}),
    ...(typeof config.output === "string" ? { dir: config.output } : {})
  }
  output.name = config.name ?? output.name ?? "index"
  output.mode = config.mode ?? output.mode ?? "single"
  output.prune = output.prune ?? (output.mode === "grouped")
  // 类型检查策略：扁平写法与嵌套 output.typeCheck 同义
  if (config.typeCheck !== undefined) output.typeCheck = config.typeCheck
  result.output = output
  // 客户端与语言支持字符串简写
  result.client = typeof config.client === "string" ? { type: config.client } : { ...(config.client ?? {}) }
  result.language = typeof config.language === "string" ? { target: config.language } : { ...(config.language ?? {}) }
  // 类型选项
  result.types = { ...(config.types ?? {}) }
  if (config.responses !== undefined) result.types.responses = config.responses
  if (config.extractResponseRaw !== undefined) result.types.extractResponseRaw = config.extractResponseRaw
  if (config.query !== undefined) result.types.extractQuery = Array.isArray(config.query) ? config.query.join(",") : config.query
  // 命名选项
  result.naming = { ...(config.naming ?? {}) }
  for (const key of ["pathPrefixIndex", "convertGetToQuery", "dropPathParams", "tagRewrite"]) {
    if (config[key] !== undefined) result.naming[key] = config[key]
  }
  // 分组模式：策略与分片阈值由工具默认，业务配置不需要写
  if (output.mode === "grouped") {
    const grouping = { ...(config.grouping ?? {}) }
    grouping.strategy = grouping.strategy ?? ["path"]
    grouping.pathDepth = grouping.pathDepth ?? result.naming.pathPrefixIndex ?? 0
    grouping.split = grouping.split ?? true
    result.grouping = grouping
  }

  // 扁平别名已并入对应段，去掉根上的副本，避免二次归一化覆盖段内配置
  for (const key of FLAT_KEYS) delete result[key]
  return result
}

/**
 * 应用命名预设：profiles[name] 按字段浅合并到顶层各段。
 * @param config 基础配置
 * @param profile 预设名
 * @return 应用后的新配置
 */
export function applyProfile(config: Record<string, any> | null, profile?: string) {
  const result: Record<string, any> = config ? structuredClone(config) : {}
  if (!profile) return result
  const preset = result.profiles?.[profile]
  if (!preset || typeof preset !== "object") return result
  for (const [section, value] of Object.entries(preset)) {
    if (section === "profiles") continue
    const current = result[section]
    result[section] =
      current && typeof current === "object" && !Array.isArray(current) && value && typeof value === "object" && !Array.isArray(value)
        ? { ...current, ...value }
        : value
  }
  return result
}

/**
 * 解析命令行里的 --config 与 --profile 值。
 * @param argv 参数列表
 * @return 指定值
 */
export function getConfigFlags(argv: string[] = process.argv.slice(2)) {
  const pick = (names: string[]) => names.reduce<string | undefined>((found, name) => found ?? (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined), undefined)
  return { configFile: pick(["--config", "-c"]), profile: pick(["--profile"]) }
}

/**
 * 生成配置来源摘要（config status 用）。
 * @param layers 三层结果
 * @return 文本行
 */
export function describeLayers(layers: ConfigLayers) {
  const lines: string[] = []
  for (const record of [layers.global, layers.project, layers.local]) {
    lines.push(`${record.layer}：${record.file ?? "未命中"}${record.hit ? `（段：${record.sections.join("、") || "无"}）` : ""}`)
  }
  return lines
}

/**
 * 判断两个目录是否相同或互相嵌套：嵌套会让一方的横幅扫描删掉另一方的产物。
 * @param left 目录
 * @param right 目录
 * @return 是否重叠
 */
function overlapsDir(left: string, right: string) {
  const contains = (parent: string, child: string) => {
    const rel = path.relative(parent, child)
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
  }
  return contains(left, right) || contains(right, left)
}

/**
 * 提取配置文件声明的输出目录（绝对路径）：顶层 output、多目标与默认值都参与。
 * @param config 原始配置
 * @param configDir 配置目录
 * @return 输出目录列表（去重）
 */
function outputDirsOf(config: Record<string, any>, configDir: string) {
  const resolveDir = (value: unknown) => (typeof value === "string" && value ? path.resolve(configDir, value) : null)
  const pick = (source: any) => {
    if (!source || typeof source !== "object") return null
    return resolveDir(source.output) ?? resolveDir(source.output?.dir)
  }
  const fallback = pick(config) ?? path.resolve(configDir, "./src/api")
  const targets = Array.isArray(config.targets) ? config.targets : []
  const dirs = targets.length ? targets.map((target) => pick(target) ?? pick(config.defaults) ?? fallback) : [fallback]
  return [...new Set(dirs)]
}

/**
 * 校验同一配置目录内的其他配置：输出目录相同或互相嵌套时互删产物，必须拒绝。
 * @param options.configDir 配置目录
 * @param options.currentFile 当前生效的配置文件（排除自身）
 * @param options.outputDirs 本配置的输出目录（绝对路径）
 * @return 冲突说明（空数组表示无冲突）
 */
export function findOutputDirConflicts(options: { configDir: string; currentFile?: string | null; outputDirs: string[] }) {
  const conflicts: string[] = []
  if (!fs.existsSync(options.configDir)) return conflicts
  const current = options.currentFile ? path.resolve(options.currentFile) : null
  for (const name of fs.readdirSync(options.configDir)) {
    // 只认项目层配置：本地层是叠加层，旧名 swagger2apirc 与新名并存时由加载器忽略
    const isProject = /^swagger2api(?:\.[^./\\]+)?\.json$/i.test(name) || /^saconfig.*\.json$/i.test(name)
    if (!isProject || name === CONFIG_LOCAL_FILE) continue
    const file = path.join(options.configDir, name)
    if (current && path.resolve(file) === current) continue
    let config: Record<string, any>
    try {
      config = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
      continue
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) continue
    for (const other of outputDirsOf(config, options.configDir)) {
      for (const own of options.outputDirs) {
        if (!overlapsDir(other, own)) continue
        conflicts.push(`输出目录 ${own} 与同目录配置 ${name} 的输出 ${other} 重叠；同一输出目录只允许一份配置`)
      }
    }
  }
  return [...new Set(conflicts)]
}
