// 分组命名契约：把任意原始组名（tag / 路径段 / 规则组名）归一为合法、稳定、唯一的模块名。
// 与生成器解耦：文件名、类名、聚合属性名全部由本模块给出，模板按映射渲染，不再从产物文件名反推。

/** 命名来源 */
export type GroupNameSource = "auto" | "manual" | "fallback"

/** 单个组名的派生结果 */
export interface GroupNameInfo {
  /** 原始组名 */
  raw: string
  /** 折叠键：NFKC + 小写 + 去分隔符，只用于匹配与判重 */
  key: string
  /** 模块文件名（不含扩展名） */
  fileName: string
  /** 模块类名 */
  className: string
  /** 聚合入口属性名 */
  property: string
  /** 聚合入口的导入来源（分桶/分片时与文件名不同；缺省即 fileName） */
  importFrom?: string
  /** 重命名原因，空串表示原样可用 */
  reason: string
  /** 命名来源 */
  source: GroupNameSource
}

/** 命名结果 */
export interface GroupNamingResult {
  /** 每个原始组名对应的命名信息（按原始名码点排序） */
  entries: GroupNameInfo[]
  /** 阻断性错误：手工名非法或互相重名 */
  errors: string[]
  /** 非阻断告警：手工名未被任何组使用 */
  warnings: string[]
}

/** 底座客户端文件名（不含扩展名） */
export const CLIENT_BASE = "client"
/** 契约目录名 */
export const TYPES_DIR = "types"
/** 共享契约文件名（不含扩展名） */
export const SHARED_BASE = "shared"
/** 旧版固定产物名：升级后按名清理残留，并继续排除在表外产物之外 */
export const LEGACY_OUTPUT_BASES = ["data-contracts", "http-client"]
/** 业务命名空间保留名（折叠键）：与固定产物或共享契约争用同名文件 / 目录 */
export const RESERVED_MODULE_NAMES = new Set(["index", CLIENT_BASE, TYPES_DIR, SHARED_BASE])
/**
 * 模块文件内的固定导入标识符与全局类型名：类名撞名会重复声明，
 * 或在同文件内遮蔽 `File` 等全局类型，改变路由参数的真实类型。
 */
const RESERVED_IDENTIFIERS = new Set([
  "HttpClient",
  "RequestParams",
  "ContentType",
  "AxiosRequestConfig",
  "AxiosResponse",
  // 浏览器 / ECMAScript 常用全局类型，避免分组后的命名空间类遮蔽路由签名中的类型
  "Array",
  "ArrayBuffer",
  "Blob",
  "Boolean",
  "Date",
  "Document",
  "Element",
  "Error",
  "Event",
  "File",
  "FileList",
  "FormData",
  "Headers",
  "Image",
  "Map",
  "Node",
  "Number",
  "Object",
  "Promise",
  "ReadableStream",
  "RegExp",
  "Request",
  "Response",
  "Set",
  "String",
  "URL",
  "Window"
])
/** 聚合类成员名：组名撞上会覆盖运行期能力；统一小写存放，比较时两侧归一 */
const RESERVED_PROPERTIES = new Set([
  "instance",
  "request",
  "setsecuritydata",
  "mergerequestparams",
  "stringifyformitem",
  "createformdata",
  "securitydata",
  "securityworker",
  "secure",
  "format",
  "constructor",
  "prototype",
  "http"
])
/** Windows 设备名：同名文件无法创建 */
const WINDOWS_DEVICES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)
])
/** 文件名长度上限：为扩展名与目录路径留余量 */
const MAX_SLUG_LENGTH = 64

/**
 * 计算折叠键：用于判重与手工名匹配，不进入产物。
 * @param raw 原始组名
 * @return 折叠后的键
 */
export function foldGroupKey(raw: string) {
  return String(raw)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

/**
 * 把拉丁词按大小写边界拆开，避免 userManage 被当成一个词。
 * @param word 拉丁词
 * @return 拆分后的词
 */
function splitAsciiWord(word: string) {
  return word
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
}

/**
 * 分词：ASCII 词按大小写边界拆开，其余文字按连续段成词；标点与路径字符只作分隔。
 * @param input 原始名称
 * @return 词序列
 */
function splitWords(input: string) {
  const normalized = input.normalize("NFKC")
  const words: string[] = []
  for (const matched of normalized.matchAll(/[A-Za-z0-9]+|[\p{L}\p{N}]+/gu)) {
    const token = matched[0]
    if (/^[A-Za-z0-9]+$/.test(token)) words.push(...splitAsciiWord(token))
    else words.push(token)
  }
  return words
}

/**
 * 词转 lowerCamel：首词全小写，其余词首字母大写、其余小写。
 * @param words 词序列
 * @return lowerCamel 形式的名称
 */
function toLowerCamel(words: string[]) {
  return words
    .map((word, index) => {
      if (/^[A-Za-z0-9]+$/.test(word)) {
        const lower = word.toLowerCase()
        return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
      }
      // 非拉丁文字无大小写概念，原样保留
      return word
    })
    .join("")
}

/**
 * 计算稳定的短哈希，用于超长截断后的区分。
 * @param input 输入文本
 * @return 6 位十六进制串
 */
function shortHash(input: string) {
  let hash = 0x811c9dc5
  for (const char of input) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 6)
}

/**
 * 基础派生：非法字符作分隔、首字符补前缀、超长截断加哈希。
 * @param raw 原始名称
 * @return 基础 slug 与重命名原因
 */
export function slugifyGroupName(raw: string) {
  const reasons: string[] = []
  const words = splitWords(raw)
  let slug = toLowerCamel(words)
  if (!slug) return { slug: "", reason: "名称不含可用字符" }
  if (/^[0-9]/.test(slug)) {
    slug = `g${slug}`
    reasons.push("数字开头")
  }
  if ([...slug].length > MAX_SLUG_LENGTH) {
    slug = [...slug].slice(0, MAX_SLUG_LENGTH - 6).join("") + shortHash(raw)
    reasons.push("超长截断")
  }
  return { slug, reason: reasons.join("、") }
}

/**
 * 类名派生：首字符大写；保留标识符加后缀。
 * @param fileName 文件名
 * @return 类名
 */
export function toClassName(fileName: string) {
  return fileName.charAt(0).toUpperCase() + fileName.slice(1)
}

/**
 * 判定名称是否与聚合类成员同名（大小写不敏感）。
 * @param name 候选属性名
 * @return 是否命中保留集合
 */
export function isReservedProperty(name: string) {
  return RESERVED_PROPERTIES.has(name.toLowerCase())
}

/**
 * 按生成器口径推导单文件模式的命名空间键：路径首段 camelCase，数字开头补 v。
 * @param raw 原始路径首段
 * @return 命名空间键
 */
export function toNamespaceName(raw: string) {
  const slug = toLowerCamel(splitWords(raw))
  return /^[0-9]/.test(slug) ? `v${slug}` : slug
}

/**
 * 构造命名表：按原始名码点排序后逐个分配，手工名优先，冲突与保留名追加序号。
 * @param groups 原始组名集合
 * @param names 手工覆盖表（键为原始名或折叠键）
 * @return 命名结果
 */
export function buildGroupNaming(groups: string[], names: Record<string, string> = {}): GroupNamingResult {
  const errors: string[] = []
  const warnings: string[] = []
  const raws = [...new Set(groups)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  // 手工名索引：同时接受原始名与折叠键，避免全半角差异要求用户写两遍
  const manualByKey = new Map<string, string>()
  const consumedKeys = new Set<string>()
  for (const [key, value] of Object.entries(names)) {
    manualByKey.set(key, value)
    manualByKey.set(foldGroupKey(key), value)
  }
  const occupied = new Set<string>()
  const usedProperties = new Set<string>()
  const entries: GroupNameInfo[] = []

  /**
   * 占用一个候选名，必要时从指定序号起追加数字直到空闲。
   * @param candidate 候选 slug
   * @param start 追加序号的起始值
   * @return 最终文件名
   */
  const take = (candidate: string, start = 2) => {
    let name = candidate
    let index = start
    while (occupied.has(name.toLowerCase())) {
      name = `${candidate}${index}`
      index += 1
    }
    occupied.add(name.toLowerCase())
    return name
  }

  /**
   * 占用一个聚合属性名：属性与文件名分开判重，保留名追加序号。
   * @param candidate 候选属性名
   * @return 最终属性名
   */
  const takeProperty = (candidate: string) => {
    let name = candidate
    let index = 2
    while (usedProperties.has(name) || RESERVED_PROPERTIES.has(name.toLowerCase())) {
      name = `${candidate}${index}`
      index += 1
    }
    usedProperties.add(name)
    return name
  }

  // 第一轮：手工名优先占用，冲突只报错不静默改名
  const manualSlugs = new Map<string, string>()
  for (const raw of raws) {
    const manual = manualByKey.get(raw) ?? manualByKey.get(foldGroupKey(raw))
    if (manual === undefined) continue
    consumedKeys.add(raw)
    consumedKeys.add(foldGroupKey(raw))
    const { slug } = slugifyGroupName(manual)
    if (!slug) {
      errors.push(`手工名不可用：${raw} → ${manual}`)
      continue
    }
    // 手工名同样不得覆盖聚合底座成员，避免生成物直接坏在运行期
    if (isReservedProperty(slug)) {
      errors.push(`手工名与聚合成员同名：${raw} → ${manual}（${slug}），请改用其他名称`)
      continue
    }
    const previous = manualSlugs.get(slug.toLowerCase())
    if (previous) errors.push(`手工名冲突：${previous} 与 ${raw} 都指向 ${slug}`)
    else manualSlugs.set(slug.toLowerCase(), raw)
    const candidate = take(slug)
    // 手工名按用户指定使用，只登记属性占用，不再二次改名
    usedProperties.add(candidate)
    const fileName = toClassName(candidate)
    entries.push({
      raw,
      key: foldGroupKey(raw),
      fileName,
      className: fileName,
      property: candidate,
      reason: candidate === slug ? "手工指定" : "手工指定、与已有组重名",
      source: "manual"
    })
  }

  // 第二轮：自动派生，保留名与重名统一追加序号
  let fallbackSeq = 1
  for (const raw of raws) {
    if (entries.some((entry) => entry.raw === raw)) continue
    const { slug, reason } = slugifyGroupName(raw)
    const fallback = !slug
    let base = slug
    if (fallback) {
      while (occupied.has(`group${fallbackSeq}`.toLowerCase())) fallbackSeq += 1
      base = `group${fallbackSeq}`
      fallbackSeq += 1
    }
    const fileReserved = RESERVED_MODULE_NAMES.has(base.toLowerCase()) || WINDOWS_DEVICES.has(base.toLowerCase())
    const identifierReserved = RESERVED_IDENTIFIERS.has(toClassName(base))
    const propertyReserved = RESERVED_PROPERTIES.has(base.toLowerCase())
    const reasons = [reason]
    let candidate: string
    let property: string
    if (propertyReserved || fileReserved) {
      candidate = take(`${base}2`, 3)
      property = takeProperty(candidate)
      reasons.push(propertyReserved ? "与聚合成员同名" : "与保留名冲突")
    } else if (identifierReserved) {
      // 只改类名与文件名，聚合属性保持原 slug，避免破坏 request.<组>
      candidate = take(`${base}2`, 3)
      property = takeProperty(base)
      reasons.push("与全局类型同名")
    } else {
      candidate = take(base)
      property = takeProperty(candidate)
      if (candidate !== base) reasons.push("与已有组重名")
    }
    const fileName = toClassName(candidate)
    entries.push({
      raw,
      key: foldGroupKey(raw),
      fileName,
      className: fileName,
      property,
      reason: reasons.filter(Boolean).join("、"),
      source: fallback ? "fallback" : "auto"
    })
  }

  // 手工配置了但没有对应组：提示配置腐化，不阻断生成
  for (const key of Object.keys(names)) {
    if (!consumedKeys.has(key) && !consumedKeys.has(foldGroupKey(key))) warnings.push(`grouping.names 中的键未出现在本次分组结果：${key}`)
  }

  return { entries, errors, warnings }
}

/**
 * 把命名表转成模板可用的类名映射。
 * @param entries 命名表
 * @return 模块名到类名的映射
 */
export function toClassNames(entries: GroupNameInfo[]) {
  const map: Record<string, string> = {}
  for (const entry of entries) {
    // 生成器以 camelCase(tag) 作为模块名，映射同时登记首字母大写与小写两种键
    map[entry.fileName] = entry.className
    map[entry.fileName.charAt(0).toLowerCase() + entry.fileName.slice(1)] = entry.className
  }
  return map
}

/**
 * 表外产物：目录中存在但不在命名表里的模块文件。
 * @param files 目录中的文件名（含扩展名）
 * @param entries 命名表
 * @param ext 产物扩展名（含点）
 * @param extraFiles 额外产物文件名（桶、分片、门面，不含扩展名）
 * @return 表外文件名
 */
export function findOrphanModules(files: string[], entries: GroupNameInfo[], ext: string, extraFiles: string[] = []) {
  const known = new Set([
    ...entries.flatMap((entry) => [`${entry.fileName}${ext}`, `${entry.importFrom ?? entry.fileName}${ext}`]),
    ...extraFiles.map((name) => `${name}${ext}`)
  ])
  // 固定产物与旧版残留都不算表外：旧版文件由升级清理负责退场
  const reserved = new Set([
    `index${ext}`,
    "index.d.ts",
    `${CLIENT_BASE}${ext}`,
    `route-types${ext}`,
    `${TYPES_DIR}/index${ext}`,
    ...LEGACY_OUTPUT_BASES.flatMap((base) => [`${base}${ext}`, `${base}.d.ts`])
  ])
  return files.filter((file) => file.endsWith(ext) && !file.endsWith(`.d${ext}`) && !known.has(file) && !reserved.has(file) && !file.endsWith(`_Route${ext}`))
}
