// 分组决策：把 spec 的每个接口归入一个组名，再经命名表转成模块名写回 tags，
// 从而支持「规则 / tag / 路径段」三种策略与阈值合并，并保证产物文件名、类名与聚合入口同源。
import { buildGroupNaming, foldGroupKey, type GroupNameInfo } from "./naming"

/** 单条分组规则 */
export interface GroupingRule {
  /** 匹配条件，命中即归入 group */
  match?: { prefix?: string; regex?: string; tag?: string; operationId?: string }
  /** 目标组名 */
  group: string
}

/** 分组配置 */
export interface GroupingConfig {
  /** 策略顺序，默认 rules → tag → path */
  strategy?: string[]
  /** 路径段深度 */
  pathDepth?: number
  /** 显式规则 */
  rules?: GroupingRule[]
  /** 低于该路由数合并进兜底组 */
  minRoutes?: number
  /** 超过该路由数组内再按下一段路径拆分 */
  maxRoutes?: number
  /** 兜底组名 */
  fallback?: string
  /** 是否在 JSDoc 的 @tags 中保留原始标签（默认 true） */
  preserveTags?: boolean
  /** 折叠键相同的组是否合并到同一原始组名（复现单文件产物的合并语义，默认 false） */
  collapse?: boolean
  /** 手工命名覆盖表：原始组名（或折叠键）→ 期望模块名 */
  names?: Record<string, string>
}

/** 组名命中来源 */
export type GroupMatchSource = "rules" | "tag" | "path" | "fallback"

/** 单次命中结果 */
export interface GroupMatch {
  /** 原始组名 */
  group: string
  /** 命中来源 */
  source: GroupMatchSource
  /** 命中的规则下标（仅 rules 来源） */
  ruleIndex?: number
}

/** 分组结果 */
export interface GroupingResult {
  /** 原始组名到路由数的映射 */
  counts: Record<string, number>
  /** 分组前的原始标签（键为「方法:路径」），用于 JSDoc 展示 */
  originalTags: Record<string, string>
  /** 命名表 */
  entries: GroupNameInfo[]
  /** 未被任何接口命中的规则下标 */
  unmatchedRules: number[]
  /** 命名错误（阻断生成） */
  errors: string[]
  /** 命名告警（不阻断） */
  warnings: string[]
}

/** HTTP 方法集合 */
const METHODS = ["get", "post", "put", "delete", "patch", "head", "options"]

/**
 * 按策略计算单个接口的组名与命中来源。
 * @param path 路径
 * @param operation 接口定义
 * @param grouping 分组配置
 * @return 组名、来源与规则下标
 */
export function matchGroup(path: string, operation: Record<string, any>, grouping: GroupingConfig): GroupMatch {
  const strategies = grouping.strategy?.length ? grouping.strategy : ["rules", "tag", "path"]
  const fallback = grouping.fallback ?? "misc"
  for (const strategy of strategies) {
    if (strategy === "rules") {
      for (const [index, rule] of (grouping.rules ?? []).entries()) {
        const match = rule.match ?? {}
        if (match.prefix && path.startsWith(match.prefix)) return { group: rule.group, source: "rules", ruleIndex: index }
        if (match.regex && new RegExp(match.regex).test(path)) return { group: rule.group, source: "rules", ruleIndex: index }
        if (match.tag && (operation.tags ?? []).includes(match.tag)) return { group: rule.group, source: "rules", ruleIndex: index }
        if (match.operationId && operation.operationId === match.operationId) return { group: rule.group, source: "rules", ruleIndex: index }
      }
    } else if (strategy === "tag") {
      const tag = (operation.tags ?? [])[0]
      if (tag) return { group: String(tag), source: "tag" }
    } else if (strategy === "path") {
      const segments = path.split("/").filter(Boolean)
      const index = grouping.pathDepth ?? 0
      if (segments[index]) return { group: segments[index], source: "path" }
    }
  }
  return { group: fallback, source: "fallback" }
}

/**
 * 为文档打组：先按策略与阈值确定原始组名，再按命名表写入模块名。
 * @param data 文档对象（原地修改）
 * @param grouping 分组配置
 * @return 分组结果（含命名表与报表所需信息）
 */
export function applyGrouping(data: Record<string, any>, grouping: GroupingConfig): GroupingResult {
  const fallback = grouping.fallback ?? "misc"
  const assignments: Array<{ path: string; method: string; operation: Record<string, any>; group: string; ruleIndex?: number }> = []
  const matchedRules = new Set<number>()
  for (const [path, item] of Object.entries(data.paths ?? {})) {
    for (const method of METHODS) {
      const operation = (item as Record<string, any>)[method]
      if (!operation || typeof operation !== "object") continue
      const match = matchGroup(path, operation, grouping)
      if (match.ruleIndex !== undefined) matchedRules.add(match.ruleIndex)
      assignments.push({ path, method, operation, group: match.group, ruleIndex: match.ruleIndex })
    }
  }

  // 折叠键相同即合并到同一原始组名：复现单文件产物「同名属性即同组」的语义
  if (grouping.collapse) {
    const canonical = new Map<string, string>()
    for (const raw of [...new Set(assignments.map((item) => item.group))].sort()) {
      const key = foldGroupKey(raw)
      if (key && !canonical.has(key)) canonical.set(key, raw)
    }
    assignments.forEach((item) => {
      const target = canonical.get(foldGroupKey(item.group))
      if (target) item.group = target
    })
  }

  // 阈值：先统计原始组大小，再决定并入兜底或按下一段路径二次拆分
  const counts = new Map<string, number>()
  assignments.forEach(({ group }) => counts.set(group, (counts.get(group) ?? 0) + 1))
  for (const item of assignments) {
    const count = counts.get(item.group) ?? 0
    if (grouping.minRoutes && count < grouping.minRoutes && item.group !== fallback) {
      item.group = fallback
    } else if (grouping.maxRoutes && count > grouping.maxRoutes) {
      const segments = item.path.split("/").filter(Boolean)
      const next = segments[(grouping.pathDepth ?? 0) + 1]
      if (next) item.group = `${item.group}_${next}`
    }
  }

  // 命名表：以最终原始组名为输入，冲突由命名模块统一解析
  const naming = buildGroupNaming(
    assignments.map((item) => item.group),
    grouping.names
  )
  const byRaw = new Map(naming.entries.map((entry) => [entry.raw, entry]))

  const originalTags: Record<string, string> = {}
  const result: Record<string, number> = {}
  for (const item of assignments) {
    const rawTags = Array.isArray(item.operation.tags) ? item.operation.tags.join(", ") : ""
    if (rawTags) originalTags[`${item.method.toUpperCase()}:${item.path}`] = rawTags
    const entry = byRaw.get(item.group)
    if (entry) item.operation.tags = [entry.fileName]
    result[item.group] = (result[item.group] ?? 0) + 1
  }

  const unmatchedRules = Array.from({ length: grouping.rules?.length ?? 0 }, (_, index) => index).filter((index) => !matchedRules.has(index))

  return { counts: result, originalTags, entries: naming.entries, unmatchedRules, errors: naming.errors, warnings: naming.warnings }
}
