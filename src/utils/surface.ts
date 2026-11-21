import fs from "node:fs"
import path from "node:path"

// 接口面基线：从生成产物提取 @request / @name 与导出类型，用于跨工具版本迁移时比对接口集合。
// 基线默认不提交，按需写入 `.swagger2api/surface.json`；多目标配置按目标 id 分组。
/** 基线格式版本（结构变化时递增） */
export const SURFACE_FORMAT_VERSION = 1
/** 需要扫描的代码文件后缀（.d.ts 先于 .ts 匹配） */
const CODE_SUFFIXES = [".d.ts", ".ts", ".js"]
/** JSDoc 中的方法名 */
const NAME_PATTERN = /@name\s+([^\r\n*]+)/
/** JSDoc 中的请求行（方法 + 路径） */
const REQUEST_PATTERN = /@request\s+([^\r\n*]+)/
/** 导出的类型声明 */
const TYPE_PATTERN = /^\s*export\s+(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm

/** 单个接口：请求行与方法名 */
export interface SurfaceRequest {
  /** 请求行，如 `GET:/app/items` */
  request: string
  /** 生成的方法名 */
  name: string
}

/** 单个目标的接口面 */
export interface SurfaceEntry {
  /** 接口集合（排序去重） */
  requests: SurfaceRequest[]
  /** 导出类型名（排序去重） */
  types: string[]
}

/** 基线文件结构：单目标直接平铺，多目标按 id 分组 */
export interface SurfacePayload {
  /** 格式版本 */
  formatVersion: number
  /** 单目标的接口集合 */
  requests?: SurfaceRequest[]
  /** 单目标的导出类型 */
  types?: string[]
  /** 多目标：目标 id → 接口面 */
  targets?: Record<string, SurfaceEntry>
}

/** 比较结果 */
export interface SurfaceDiff {
  /** 差异行：`+` 新增 / `-` 缺失 */
  lines: string[]
  /** 结构性错误：目标集合或格式版本变化 */
  errors: string[]
}

/**
 * 递归收集目录内的代码文件（相对路径，统一 / 分隔）。
 * @param dir 目录
 * @param base 基准目录
 * @return 相对路径列表
 */
function collectCodeFiles(dir: string, base = dir): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue
      files.push(...collectCodeFiles(full, base))
      continue
    }
    if (CODE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) files.push(path.relative(base, full).split(path.sep).join("/"))
  }
  return files.sort()
}

/**
 * 从产物目录提取接口面。
 * @param dir 产物目录
 * @param options.requestsOnly 只提取接口集合，忽略方法与导出类型
 * @return 接口面
 */
export function collectSurface(dir: string, options: { requestsOnly?: boolean } = {}): SurfaceEntry {
  const requests: SurfaceRequest[] = []
  const types = new Set<string>()
  for (const file of collectCodeFiles(dir)) {
    const content = fs.readFileSync(path.join(dir, file), "utf8")
    // 同一 JSDoc 内先出现 @name 再出现 @request，按行顺序配对
    let pendingName = ""
    for (const line of content.split(/\r?\n/)) {
      const name = NAME_PATTERN.exec(line)
      if (name) {
        pendingName = name[1].trim()
        continue
      }
      const request = REQUEST_PATTERN.exec(line)
      if (!request) continue
      requests.push({ request: request[1].trim(), name: pendingName })
      pendingName = ""
    }
    if (options.requestsOnly) continue
    for (const match of content.matchAll(TYPE_PATTERN)) types.add(match[1])
  }
  const unique = new Map<string, SurfaceRequest>()
  for (const item of requests) unique.set(`${item.request}\u0000${item.name}`, item)
  return {
    requests: [...unique.values()].sort((left, right) => (left.request === right.request ? left.name.localeCompare(right.name) : left.request.localeCompare(right.request))),
    types: [...types].sort((left, right) => left.localeCompare(right))
  }
}

/**
 * 接口比较键：只锁接口集合时不看方法名。
 * @param item 接口
 * @param requestsOnly 是否只比较接口集合
 * @return 比较键
 */
function requestKey(item: SurfaceRequest, requestsOnly: boolean) {
  return requestsOnly ? item.request : `${item.request}\u0000${item.name}`
}

/**
 * 接口展示文本。
 * @param item 接口
 * @param requestsOnly 是否只比较接口集合
 * @return 展示文本
 */
function displayRequest(item: SurfaceRequest, requestsOnly: boolean) {
  return requestsOnly ? item.request : `${item.request}（${item.name || "未命名"}）`
}

/**
 * 比较单个目标的接口面。
 * @param current 当前接口面
 * @param baseline 基线接口面
 * @param requestsOnly 是否只比较接口集合
 * @param prefix 差异行前缀（多目标时带目标 id）
 * @return 差异行
 */
function compareEntry(current: SurfaceEntry, baseline: SurfaceEntry, requestsOnly: boolean, prefix: string) {
  const lines: string[] = []
  const currentRequests = new Map(current.requests.map((item) => [requestKey(item, requestsOnly), item]))
  const baselineRequests = new Map(baseline.requests.map((item) => [requestKey(item, requestsOnly), item]))
  for (const [key, item] of [...currentRequests].sort(([left], [right]) => left.localeCompare(right))) {
    if (!baselineRequests.has(key)) lines.push(`+ ${prefix}接口 ${displayRequest(item, requestsOnly)}`)
  }
  for (const [key, item] of [...baselineRequests].sort(([left], [right]) => left.localeCompare(right))) {
    if (!currentRequests.has(key)) lines.push(`- ${prefix}接口 ${displayRequest(item, requestsOnly)}`)
  }
  if (requestsOnly) return lines
  const currentTypes = new Set(current.types)
  const baselineTypes = new Set(baseline.types)
  for (const type of [...currentTypes].sort()) if (!baselineTypes.has(type)) lines.push(`+ ${prefix}类型 ${type}`)
  for (const type of [...baselineTypes].sort()) if (!currentTypes.has(type)) lines.push(`- ${prefix}类型 ${type}`)
  return lines
}

/**
 * 比较当前接口面与基线：目标集合、格式版本变化计入结构错误。
 * @param current 当前接口面
 * @param baseline 基线接口面
 * @param options.requestsOnly 是否只比较接口集合
 * @return 比较结果
 */
export function compareSurface(current: SurfacePayload, baseline: SurfacePayload, options: { requestsOnly?: boolean } = {}): SurfaceDiff {
  const requestsOnly = Boolean(options.requestsOnly)
  const lines: string[] = []
  const errors: string[] = []
  if (baseline.formatVersion !== current.formatVersion) errors.push(`基线格式版本不一致：${baseline.formatVersion} / ${current.formatVersion}`)
  const currentTargets = current.targets
  const baselineTargets = baseline.targets
  if (Boolean(currentTargets) !== Boolean(baselineTargets)) {
    errors.push("目标结构不一致：一侧按 targets 分组，另一侧为单目标")
    return { lines, errors }
  }
  if (currentTargets && baselineTargets) {
    const ids = [...new Set([...Object.keys(currentTargets), ...Object.keys(baselineTargets)])].sort()
    for (const id of ids) {
      const currentEntry = currentTargets[id]
      const baselineEntry = baselineTargets[id]
      if (!baselineEntry) {
        errors.push(`新增目标：${id}`)
        continue
      }
      if (!currentEntry) {
        errors.push(`缺失目标：${id}`)
        continue
      }
      lines.push(...compareEntry(currentEntry, baselineEntry, requestsOnly, `[${id}] `))
    }
    return { lines, errors }
  }
  lines.push(
    ...compareEntry(
      { requests: current.requests ?? [], types: current.types ?? [] },
      { requests: baseline.requests ?? [], types: baseline.types ?? [] },
      requestsOnly,
      ""
    )
  )
  return { lines, errors }
}
