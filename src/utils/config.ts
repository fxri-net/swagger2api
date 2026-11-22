import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// 配置分层：全局层 ~/.swagger2api.json（个人跨项目）、项目层 swagger2api.json（团队共享，向上查找）、
// 本地层 swagger2api.local.json（个人按项目，默认不入库）。三层统一使用 base / docs / profiles 结构。
/** 项目层配置文件名 */
export const CONFIG_PROJECT_FILE = "swagger2api.json"
/** 本地层配置文件名 */
export const CONFIG_LOCAL_FILE = "swagger2api.local.json"
/** 全局层配置文件名（个人跨项目，隐藏文件） */
export const CONFIG_GLOBAL_FILE = ".swagger2api.json"

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
  /** 结构错误（非空即不得生成） */
  errors: string[]
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
 * 判断是否为可递归合并的普通对象。
 * @param value 任意值
 * @return 是否普通对象
 */
function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * 深度合并：对象逐键递归，数组与其它类型整体替换。
 * @param base 底层
 * @param overlay 覆盖层
 * @return 合并结果
 */
export function deepMergeConfig(base: unknown, overlay: unknown): any {
  if (!isPlainObject(base)) return overlay === undefined ? overlay : structuredClone(overlay)
  const result: Record<string, any> = structuredClone(base)
  if (!isPlainObject(overlay)) return result
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? deepMergeConfig(result[key], value) : structuredClone(value)
  }
  return result
}

/** 各层允许的根键 */
const LAYER_KEYS: Record<ConfigLayerName, string[]> = {
  全局层: ["base", "profiles"],
  项目层: ["base", "docs", "profiles"],
  本地层: ["base", "docs", "profiles"]
}

/**
 * 校验单层根键。
 * @param record 层记录
 * @param errors 错误收集
 * @return 无
 */
function validateLayerKeys(record: ConfigLayerRecord, errors: string[]) {
  if (!record.hit || !record.config) return
  const allowed = new Set(LAYER_KEYS[record.layer])
  for (const key of Object.keys(record.config)) {
    if (allowed.has(key)) continue
    errors.push(`${record.file ?? record.layer}：不支持的根字段 ${key}（仅允许 ${[...allowed].join(" / ")}）；请迁移到 base / docs`)
  }
}

/**
 * 合并三层配置：base / profiles 深度合并，docs 按 id 覆盖或追加。
 * @param layers 全局、项目、本地层记录
 * @param errors 错误收集
 * @return 合并结果
 */
function mergeConfigLayers(layers: ConfigLayerRecord[], errors: string[]) {
  const merged: Record<string, any> = { base: {}, docs: [], profiles: {} }
  for (const record of layers) {
    if (!record.hit || !record.config) continue
    if (isPlainObject(record.config.base)) merged.base = deepMergeConfig(merged.base, record.config.base)
    if (isPlainObject(record.config.profiles)) merged.profiles = deepMergeConfig(merged.profiles, record.config.profiles)
    if (record.config.docs === undefined) continue
    if (record.layer === "全局层") {
      errors.push(`${record.file}：全局层不允许声明 docs`)
      continue
    }
    if (!Array.isArray(record.config.docs)) {
      errors.push(`${record.file}：docs 必须是数组`)
      continue
    }
    for (const raw of record.config.docs) {
      if (!isPlainObject(raw) || typeof raw.id !== "string" || !raw.id.trim()) {
        merged.docs.push(raw)
        continue
      }
      const index = merged.docs.findIndex((item) => isPlainObject(item) && item.id === raw.id)
      if (index === -1) merged.docs.push(structuredClone(raw))
      else merged.docs[index] = deepMergeConfig(merged.docs[index], raw)
    }
  }
  return merged
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
  const errors: string[] = []
  if (String(options.projectFile ?? "").includes(",")) errors.push("--config 只接受单个配置文件")
  const home = options.homeDir ?? os.homedir()
  const globalPick = fs.existsSync(path.join(home, CONFIG_GLOBAL_FILE)) ? { file: path.join(home, CONFIG_GLOBAL_FILE) } : null
  const projectPick = options.projectFile ? { file: path.resolve(options.projectFile) } : findUpward(CONFIG_PROJECT_FILE, cwd) ? { file: findUpward(CONFIG_PROJECT_FILE, cwd) as string } : null
  const localPick = findUpward(CONFIG_LOCAL_FILE, cwd) ? { file: findUpward(CONFIG_LOCAL_FILE, cwd) as string } : null
  const global = readLayer(globalPick?.file ?? null, "全局层", warnings)
  const project = readLayer(projectPick?.file ?? null, "项目层", warnings)
  const local = readLayer(localPick?.file ?? null, "本地层", warnings)
  for (const record of [global, project, local]) validateLayerKeys(record, errors)
  const merged = project.hit ? mergeConfigLayers([global, project, local], errors) : null
  return { global, project, local, merged, warnings, errors }
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

/**
 * 应用命名预设到 base：preset 直接深度合并进 base。
 * @param base 基础配置
 * @param profiles 预设表
 * @param profile 预设名
 * @return 合并后的 base
 */
export function applyProfileToBase(base: Record<string, any> | undefined, profiles: Record<string, any> | undefined, profile?: string) {
  const result = isPlainObject(base) ? structuredClone(base) : {}
  if (!profile || !isPlainObject(profiles)) return result
  const preset = profiles[profile]
  if (!isPlainObject(preset)) return result
  return deepMergeConfig(result, preset)
}

/**
 * 单文档配置归一：source 合入 input，字符串简写转为对象，补齐输出默认值。
 * 只处理文档级差异，不注入分组默认值，保证显式分组配置原样生效。
 * @param config base 与文档项合并后的配置
 * @return 内部归一化配置
 */
export function normalizeDocConfig(config: Record<string, any>): Record<string, any> {
  const raw = structuredClone(config)
  const source = raw.source
  delete raw.source
  const input = isPlainObject(raw.input) ? { ...raw.input } : {}
  if (typeof source === "string") {
    if (/^https?:\/\//i.test(source)) input.url = source
    else input.file = source
  } else if (isPlainObject(source)) {
    Object.assign(input, source)
  }
  raw.input = input
  if (typeof raw.client === "string") raw.client = { type: raw.client }
  if (typeof raw.language === "string") raw.language = { target: raw.language }
  const output: Record<string, any> = isPlainObject(raw.output) ? { ...raw.output } : typeof raw.output === "string" ? { dir: raw.output } : {}
  output.name = output.name ?? raw.name ?? "index"
  output.mode = output.mode ?? raw.mode ?? "single"
  output.prune = output.prune ?? (output.mode === "grouped")
  raw.output = output
  // 分组模式未显式配置时按路径分组并分桶；显式配置原样生效，不追加默认阈值
  if (output.mode === "grouped" && (!isPlainObject(raw.grouping) || Object.keys(raw.grouping).length === 0)) {
    raw.grouping = { strategy: ["path"], pathDepth: 0, split: true }
  }
  delete raw.name
  delete raw.mode
  return raw
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

