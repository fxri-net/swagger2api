// 分组决策：把 spec 的每个接口归入一个组名，通过重写 tags 交给模块化模板，
// 从而支持「规则 / tag / 路径段」三种策略与阈值合并，而不是只能按路径首段切分。
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
}
/** HTTP 方法集合 */
const METHODS = ["get", "post", "put", "delete", "patch", "head", "options"]

/**
 * 按策略计算单个接口的组名。
 * @param path 路径
 * @param operation 接口定义
 * @param grouping 分组配置
 * @return 组名（空串表示未命中，由兜底处理）
 */
export function matchGroup(path: string, operation: Record<string, any>, grouping: GroupingConfig) {
  const strategies = grouping.strategy?.length ? grouping.strategy : ["rules", "tag", "path"]
  const fallback = grouping.fallback ?? "misc"
  for (const strategy of strategies) {
    if (strategy === "rules") {
      for (const rule of grouping.rules ?? []) {
        const match = rule.match ?? {}
        if (match.prefix && path.startsWith(match.prefix)) return rule.group
        if (match.regex && new RegExp(match.regex).test(path)) return rule.group
        if (match.tag && (operation.tags ?? []).includes(match.tag)) return rule.group
        if (match.operationId && operation.operationId === match.operationId) return rule.group
      }
    } else if (strategy === "tag") {
      const tag = (operation.tags ?? [])[0]
      if (tag) return String(tag)
    } else if (strategy === "path") {
      const segments = path.split("/").filter(Boolean)
      const index = grouping.pathDepth ?? 0
      if (segments[index]) return segments[index]
    }
  }
  return fallback
}

/**
 * 为文档打组：重写每个接口的 tags，并处理阈值合并与拆分。
 * @param data 文档对象（原地修改）
 * @param grouping 分组配置
 * @return 组名到路由数的映射
 */
export function applyGrouping(data: Record<string, any>, grouping: GroupingConfig) {
  const assignments: Array<{ path: string; method: string; operation: Record<string, any>; group: string }> = []
  for (const [path, item] of Object.entries(data.paths ?? {})) {
    for (const method of METHODS) {
      const operation = (item as Record<string, any>)[method]
      if (!operation || typeof operation !== "object") continue
      assignments.push({ path, method, operation, group: matchGroup(path, operation, grouping) })
    }
  }
  const counts = new Map<string, number>()
  assignments.forEach(({ group }) => counts.set(group, (counts.get(group) ?? 0) + 1))

  const fallback = grouping.fallback ?? "misc"
  const finalGroups: string[] = []
  /** 原始标签映射：键为「方法:路径」，供模板保留 @tags 展示 */
  const originalTags: Record<string, string> = {}
  for (const item of assignments) {
    const rawTags = Array.isArray(item.operation.tags) ? item.operation.tags.join(", ") : ""
    if (rawTags) originalTags[`${item.method.toUpperCase()}:${item.path}`] = rawTags
    let group = item.group
    const count = counts.get(group) ?? 0
    if (grouping.minRoutes && count < grouping.minRoutes && group !== fallback) {
      group = fallback
    } else if (grouping.maxRoutes && count > grouping.maxRoutes) {
      // 超阈值：按下一段路径再拆一层，避免单文件过大
      const segments = item.path.split("/").filter(Boolean)
      const next = segments[(grouping.pathDepth ?? 0) + 1]
      if (next) group = `${group}_${next}`
    }
    item.operation.tags = [group]
    finalGroups.push(group)
  }
  const result: Record<string, number> = {}
  finalGroups.forEach((group) => {
    result[group] = (result[group] ?? 0) + 1
  })
  return { counts: result, originalTags }
}
