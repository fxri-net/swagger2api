// 分组决策：把 spec 的每个接口归入一个组名，再经命名表转成模块名写回 tags，
// 从而支持「规则 / tag / 路径段」三种策略与阈值合并，并保证产物文件名、类名与聚合入口同源。
import { buildGroupNaming, foldGroupKey, slugifyGroupName, toClassName, type GroupNameInfo } from "./naming"

/** 单条分组规则 */
export interface GroupingRule {
  /** 匹配条件，命中即归入 group */
  match?: { prefix?: string; regex?: string; tag?: string; operationId?: string }
  /** 目标组名 */
  group: string
}

/** 桶分类规则：命名空间名称命中即归入该分类 */
export interface SplitCategory {
  /** 分类名，同时作为桶文件名候选 */
  name: string
  /** 匹配条件，按原始命名空间名判断 */
  match?: { prefix?: string; regex?: string }
}

/** 自适应分桶与命名空间分片配置 */
export interface SplitConfig {
  /** 产物总路由数不超过该值时只出一个模块文件（默认 150） */
  minRoutes?: number
  /** 单个模块文件的目标路由数（默认 300） */
  targetRoutes?: number
  /** 单命名空间超过该值时启用分片（默认 450） */
  maxRoutes?: number
  /** 尾桶低于该路由数时并入前一桶（默认 60） */
  minBucketRoutes?: number
  /** 分类规则；未配置时桶名取首个命名空间名占位 */
  categories?: SplitCategory[]
  /** 未命中分类的命名空间所用桶名（默认 misc） */
  fallback?: string
}

/** 分组配置 */
export interface GroupingConfig {
  /** 策略顺序，默认 rules → tag → path */
  strategy?: string[]
  /** 路径段深度 */
  pathDepth?: number
  /** 显式规则 */
  rules?: GroupingRule[]
  /** 低于该路由数合并进兜底组（启用 split 时忽略） */
  minRoutes?: number
  /** 超过该路由数组内再按下一段路径拆分（启用 split 时忽略） */
  maxRoutes?: number
  /** 兜底组名 */
  fallback?: string
  /** 是否在 JSDoc 的 @tags 中保留原始标签（默认 true） */
  preserveTags?: boolean
  /** 折叠键相同的组是否合并到同一原始组名（复现单文件产物的合并语义，默认 false） */
  collapse?: boolean
  /** 手工命名覆盖表：原始组名（或折叠键）→ 期望模块名 */
  names?: Record<string, string>
  /** 自适应分桶与命名空间分片；缺省或 false 时保持一命名空间一文件 */
  split?: boolean | SplitConfig
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

/** 单个命名空间内继续拆分出的分片 */
export interface SplitChunkPlan {
  /** 生成器 tag（与文件名一致） */
  tag: string
  /** 分片文件名（不含扩展名） */
  fileName: string
  /** 分片类名 */
  className: string
  /** 分片内路由数 */
  routes: number
  /** 分片覆盖的子分类 */
  categories: string[]
}

/** 命名空间规划结果 */
export interface SplitNamespacePlan {
  /** 原始组名 */
  raw: string
  /** 门面或唯一文件名（不含扩展名） */
  fileName: string
  /** 类名 */
  className: string
  /** 路由数 */
  routes: number
  /** 所在桶文件名（分片时为 null） */
  bucket: string | null
  /** 分片列表（未分片为空） */
  chunks: SplitChunkPlan[]
}

/** 桶规划结果 */
export interface SplitBucketPlan {
  /** 桶文件名（不含扩展名） */
  fileName: string
  /** 桶类名（仅用于报告） */
  className: string
  /** 分类名，未配置分类时为空串 */
  category: string
  /** 桶内路由数 */
  routes: number
  /** 桶内命名空间原始名（按码点排序） */
  namespaces: string[]
}

/** 桶内命名空间布局，供模板渲染多类文件 */
export interface SplitBucketNamespace {
  /** 命名空间文件名（即路由上的 x-s2a-namespace 标记） */
  tag: string
  /** 命名空间类名 */
  className: string
  /** 原始名称（JSDoc 展示） */
  title: string
  /** 路由数 */
  routes: number
}

/** 自适应分桶与分片规划结果 */
export interface SplitPlan {
  /** 产物总路由数 */
  total: number
  /** 桶列表 */
  buckets: SplitBucketPlan[]
  /** 命名空间规划 */
  namespaces: SplitNamespacePlan[]
  /** 生成器模块名 → 桶内布局（同时登记首字母大小写两种键） */
  bucketLayout: Record<string, SplitBucketNamespace[]>
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
  /** 自适应分桶规划（未启用 split 时为空） */
  split?: SplitPlan
  /** 生成器模块名 → 类名（含分片类；未启用 split 时由命名表推导） */
  moduleClassNames?: Record<string, string>
}

/** HTTP 方法集合 */
const METHODS = ["get", "post", "put", "delete", "patch", "head", "options"]

/** 固定产物占用的文件名 */
const RESERVED_FILES = ["index", "data-contracts", "http-client", "route-types"]

/** 单个路由的分组分配 */
interface RouteAssignment {
  /** 路径 */
  path: string
  /** 方法 */
  method: string
  /** 接口定义 */
  operation: Record<string, any>
  /** 原始组名 */
  group: string
  /** 命中的规则下标 */
  ruleIndex?: number
  /** 写入 tags 的生成器 tag（分桶或分片） */
  splitTag?: string
}

/** 归一化后的分片配置 */
interface NormalizedSplitConfig {
  minRoutes: number
  targetRoutes: number
  maxRoutes: number
  minBucketRoutes: number
  categories: SplitCategory[]
  fallback: string
}

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
  const assignments: RouteAssignment[] = []
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

  // 自适应分桶：阈值、分桶与分片统一由 split 规划，命名表在一次规划内生成
  if (grouping.split !== undefined && grouping.split !== false) {
    const naming = buildGroupNaming(
      assignments.map((item) => item.group),
      grouping.names
    )
    const split = typeof grouping.split === "object" ? grouping.split : {}
    return applySplit(assignments, grouping, split, naming, matchedRules)
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

/**
 * 归一化分片配置：非法数值回落到默认值并告警，避免静默降级。
 * @param split 分片配置
 * @param warnings 告警收集器
 * @return 归一化配置
 */
function normalizeSplitConfig(split: SplitConfig, warnings: string[]): NormalizedSplitConfig {
  const number = (value: number | undefined, fallback: number, name: string) => {
    if (value === undefined) return fallback
    if (!Number.isFinite(value) || value < 1) {
      warnings.push(`grouping.split.${name} 无效（${value}），回落到 ${fallback}`)
      return fallback
    }
    return Math.floor(value)
  }
  // 分类来自用户配置：逐条校验，非法项跳过并告警，避免生成中途抛异常
  const categories: SplitCategory[] = []
  if (split.categories !== undefined && !Array.isArray(split.categories)) {
    warnings.push("grouping.split.categories 必须是数组，已忽略")
  } else {
    for (const category of split.categories ?? []) {
      if (!category || typeof category.name !== "string" || !category.name) {
        warnings.push("grouping.split.categories 存在缺少 name 的项，已忽略")
        continue
      }
      const regex = category.match?.regex
      if (regex) {
        try {
          new RegExp(regex)
        } catch {
          warnings.push(`grouping.split.categories 的正则无效（${category.name}：${regex}），已忽略该项`)
          continue
        }
      }
      categories.push(category)
    }
  }
  return {
    minRoutes: number(split.minRoutes, 150, "minRoutes"),
    targetRoutes: number(split.targetRoutes, 300, "targetRoutes"),
    maxRoutes: number(split.maxRoutes, 450, "maxRoutes"),
    minBucketRoutes: number(split.minBucketRoutes, 60, "minBucketRoutes"),
    categories,
    fallback: typeof split.fallback === "string" && split.fallback ? split.fallback : "misc"
  }
}

/**
 * 计算分桶与分片规划，并把生成器 tag 与命名空间标记写回接口。
 * @param assignments 路由分配
 * @param grouping 分组配置
 * @param split 分片配置
 * @param naming 命名表
 * @param matchedRules 已命中的规则下标
 * @return 分组结果
 */
function applySplit(
  assignments: RouteAssignment[],
  grouping: GroupingConfig,
  split: SplitConfig,
  naming: ReturnType<typeof buildGroupNaming>,
  matchedRules: Set<number>
): GroupingResult {
  const warnings = [...naming.warnings]
  if (grouping.minRoutes !== undefined || grouping.maxRoutes !== undefined) {
    warnings.push("已启用 grouping.split，忽略 grouping.minRoutes / grouping.maxRoutes，阈值改由 grouping.split 提供")
  }
  const config = normalizeSplitConfig(split, warnings)
  const entryByRaw = new Map(naming.entries.map((entry) => [entry.raw, entry]))
  const assignmentsByRaw = new Map<string, RouteAssignment[]>()
  for (const item of assignments) {
    const list = assignmentsByRaw.get(item.group)
    if (list) list.push(item)
    else assignmentsByRaw.set(item.group, [item])
  }

  // 先占用分片门面名，再分配分片文件名，避免分片名与门面名互撞
  const plans: SplitNamespacePlan[] = naming.entries.map((entry) => ({
    raw: entry.raw,
    fileName: entry.fileName,
    className: entry.className,
    routes: assignmentsByRaw.get(entry.raw)?.length ?? 0,
    bucket: null,
    chunks: []
  }))
  const occupied = new Set(RESERVED_FILES.map((name) => name.toLowerCase()))
  plans.filter((plan) => plan.routes > config.maxRoutes).forEach((plan) => occupied.add(plan.fileName.toLowerCase()))

  for (const plan of plans) {
    if (plan.routes <= config.maxRoutes) continue
    const list = assignmentsByRaw.get(plan.raw) ?? []
    plan.chunks = planChunks(plan, list, grouping.pathDepth ?? 0, config, occupied)
  }

  const total = assignments.length
  const buckets = packBuckets(
    plans.filter((plan) => plan.chunks.length === 0),
    total,
    config,
    occupied,
    warnings
  )
  const planByRaw = new Map(plans.map((plan) => [plan.raw, plan]))
  for (const bucket of buckets) {
    bucket.namespaces.forEach((raw) => {
      const plan = planByRaw.get(raw)
      if (plan) plan.bucket = bucket.fileName
    })
  }

  // 重写 tags：分桶写桶名，分片写分片名；同时标记命名空间供桶文件渲染多类
  const originalTags: Record<string, string> = {}
  const counts: Record<string, number> = {}
  for (const item of assignments) {
    const entry = entryByRaw.get(item.group)
    const plan = planByRaw.get(item.group)
    if (!entry || !plan) continue
    const rawTags = Array.isArray(item.operation.tags) ? item.operation.tags.join(", ") : ""
    if (rawTags) originalTags[`${item.method.toUpperCase()}:${item.path}`] = rawTags
    const tag = item.splitTag ?? plan.bucket
    // 第二个标签记录命名空间：生成器只按首标签分文件，桶文件内据此区分类
    if (tag) item.operation.tags = [tag, entry.fileName]
    counts[item.group] = (counts[item.group] ?? 0) + 1
  }

  // 聚合入口的导入来源：分片走门面，其余走桶文件
  for (const plan of plans) {
    const entry = entryByRaw.get(plan.raw)
    if (entry) entry.importFrom = plan.chunks.length ? plan.fileName : plan.bucket ?? plan.fileName
  }

  const moduleClassNames: Record<string, string> = {}
  const register = (fileName: string, className: string) => {
    moduleClassNames[fileName] = className
    moduleClassNames[fileName.charAt(0).toLowerCase() + fileName.slice(1)] = className
  }
  naming.entries.forEach((entry) => register(entry.fileName, entry.className))
  plans.forEach((plan) => plan.chunks.forEach((chunk) => register(chunk.fileName, chunk.className)))

  const bucketLayout: Record<string, SplitBucketNamespace[]> = {}
  for (const bucket of buckets) {
    const namespaces = bucket.namespaces.map((raw) => {
      const plan = planByRaw.get(raw) as SplitNamespacePlan
      return { tag: plan.fileName, className: plan.className, title: plan.raw, routes: plan.routes }
    })
    bucketLayout[bucket.fileName] = namespaces
    bucketLayout[bucket.fileName.charAt(0).toLowerCase() + bucket.fileName.slice(1)] = namespaces
  }

  const unmatchedRules = Array.from({ length: grouping.rules?.length ?? 0 }, (_, index) => index).filter((index) => !matchedRules.has(index))

  return {
    counts,
    originalTags,
    entries: naming.entries,
    unmatchedRules,
    errors: naming.errors,
    warnings,
    split: { total, buckets, namespaces: plans, bucketLayout },
    moduleClassNames
  }
}

/**
 * 取命名空间之后的子分类段：跳过版本段与路径参数段。
 * @param path 路径
 * @param namespaceRaw 命名空间原始名
 * @param pathDepth 分组路径深度
 * @return 子分类名，取不到时返回 rest
 */
function subCategory(path: string, namespaceRaw: string, pathDepth: number) {
  const segments = path.split("/").filter(Boolean)
  const located = segments.indexOf(namespaceRaw)
  const start = located >= 0 ? located + 1 : pathDepth + 1
  for (let index = start; index < segments.length; index += 1) {
    const segment = segments[index]
    if (/^v\d+$/i.test(segment)) continue
    if (/^\{.*\}$/.test(segment)) continue
    return segment
  }
  return "rest"
}

/**
 * 把超大命名空间按子分类顺序装箱到目标路由数。
 * @param namespace 命名空间规划
 * @param list 该命名空间的路由
 * @param pathDepth 分组路径深度
 * @param config 归一化后的分片配置
 * @param occupied 已占用的文件名（小写）
 * @return 分片列表
 */
function planChunks(namespace: SplitNamespacePlan, list: RouteAssignment[], pathDepth: number, config: NormalizedSplitConfig, occupied: Set<string>) {
  const byCategory = new Map<string, RouteAssignment[]>()
  for (const item of list) {
    const key = subCategory(item.path, namespace.raw, pathDepth)
    const bucket = byCategory.get(key)
    if (bucket) bucket.push(item)
    else byCategory.set(key, [item])
  }

  // 子分类按码点排序后顺序装箱，保证同一 spec 两次生成结果一致
  const groups: Array<{ items: RouteAssignment[]; categories: Set<string> }> = []
  let current: { items: RouteAssignment[]; categories: Set<string> } = { items: [], categories: new Set() }
  for (const [category, items] of [...byCategory.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))) {
    for (const item of items) {
      if (current.items.length >= config.targetRoutes) {
        groups.push(current)
        current = { items: [], categories: new Set() }
      }
      current.items.push(item)
      current.categories.add(category)
    }
  }
  if (current.items.length) groups.push(current)

  return groups.map((group, index) => {
    let part = index + 1
    let fileName = `${namespace.className}Part${part}`
    while (occupied.has(fileName.toLowerCase())) {
      part += 1
      fileName = `${namespace.className}Part${part}`
    }
    occupied.add(fileName.toLowerCase())
    group.items.forEach((item) => {
      item.splitTag = fileName
    })
    return {
      tag: fileName,
      fileName,
      className: fileName,
      routes: group.items.length,
      categories: [...group.categories].sort()
    }
  })
}

/**
 * 判断命名空间是否命中分类规则。
 * @param plan 命名空间规划
 * @param category 分类规则
 * @return 是否命中
 */
function matchesCategory(plan: SplitNamespacePlan, category: SplitCategory) {
  const match = category.match ?? {}
  if (match.prefix && plan.raw.startsWith(match.prefix)) return true
  if (match.regex && new RegExp(match.regex).test(plan.raw)) return true
  return false
}

/**
 * 占用一个桶文件名，冲突时追加序号（Windows 大小写不敏感）。
 * @param candidate 候选名
 * @param occupied 已占用的文件名（小写）
 * @return 可用的文件名
 */
function reserveBucketName(candidate: string, occupied: Set<string>) {
  let fileName = candidate
  let index = 2
  while (occupied.has(fileName.toLowerCase())) {
    fileName = `${candidate}${index}`
    index += 1
  }
  occupied.add(fileName.toLowerCase())
  return fileName
}

/**
 * 合并过小的桶：小桶优先并入前一桶，前一桶放不下再并入后一桶，均不得超过上限。
 * 大命名空间独立成桶后留下的碎片桶由此消除，桶内顺序保持不变。
 * @param groups 装箱结果（会被原地修改）
 * @param config 归一化后的分片配置
 * @return 无
 */
function mergeSmallBuckets(groups: Array<{ plans: SplitNamespacePlan[]; routes: number }>, config: NormalizedSplitConfig) {
  let index = 0
  while (groups.length > 1 && index < groups.length) {
    const group = groups[index]
    if (group.routes >= config.minBucketRoutes) {
      index += 1
      continue
    }
    const previous = groups[index - 1]
    if (previous && previous.routes + group.routes <= config.maxRoutes) {
      previous.plans.push(...group.plans)
      previous.routes += group.routes
      groups.splice(index, 1)
      index = Math.max(index - 1, 0)
      continue
    }
    const next = groups[index + 1]
    if (next && next.routes + group.routes <= config.maxRoutes) {
      next.plans.unshift(...group.plans)
      next.routes += group.routes
      groups.splice(index, 1)
      continue
    }
    index += 1
  }
}

/**
 * 按分类装箱并命名桶：顺序装箱、目标路由数封顶、过小的桶与相邻桶合并。
 * @param plans 待装箱的命名空间（已按码点排序）
 * @param categoryName 分类名；为空时用首个命名空间名占位
 * @param config 归一化后的分片配置
 * @param occupied 已占用的文件名（小写）
 * @return 桶列表
 */
function packCategory(plans: SplitNamespacePlan[], categoryName: string, config: NormalizedSplitConfig, occupied: Set<string>) {
  const groups: Array<{ plans: SplitNamespacePlan[]; routes: number }> = []
  let current: SplitNamespacePlan[] = []
  let routes = 0
  for (const plan of plans) {
    if (routes > 0 && routes + plan.routes > config.targetRoutes) {
      groups.push({ plans: current, routes })
      current = []
      routes = 0
    }
    current.push(plan)
    routes += plan.routes
  }
  if (current.length) groups.push({ plans: current, routes })
  mergeSmallBuckets(groups, config)

  return groups.map((group) => {
    // 未配置分类且只有一个桶时用固定名，避免以首个命名空间占位造成误解
    const candidate = categoryName ? toClassName(slugifyGroupName(categoryName).slug || "bucket") : groups.length === 1 ? "Modules" : group.plans[0].fileName
    const fileName = reserveBucketName(candidate, occupied)
    return {
      fileName,
      className: fileName,
      category: categoryName,
      routes: group.routes,
      namespaces: group.plans.map((plan) => plan.raw)
    }
  })
}

/**
 * 规划桶：总量低于阈值只出一个文件；配置分类时按分类装箱，否则按命名空间顺序装箱。
 * @param plans 未分片的命名空间（已按码点排序）
 * @param total 产物总路由数
 * @param config 归一化后的分片配置
 * @param occupied 已占用的文件名（小写）
 * @param warnings 告警收集器
 * @return 桶列表
 */
function packBuckets(plans: SplitNamespacePlan[], total: number, config: NormalizedSplitConfig, occupied: Set<string>, warnings: string[]) {
  if (plans.length === 0) return []
  if (total <= config.minRoutes) {
    const fileName = reserveBucketName("Modules", occupied)
    const routes = plans.reduce((sum, plan) => sum + plan.routes, 0)
    return [{ fileName, className: fileName, category: "", routes, namespaces: plans.map((plan) => plan.raw) }]
  }

  if (config.categories.length === 0) return packCategory(plans, "", config, occupied)

  const buckets: SplitBucketPlan[] = []
  const remaining = new Set(plans.map((plan) => plan.raw))
  for (const category of config.categories) {
    const matched = plans.filter((plan) => remaining.has(plan.raw) && matchesCategory(plan, category))
    matched.forEach((plan) => remaining.delete(plan.raw))
    if (matched.length) buckets.push(...packCategory(matched, category.name, config, occupied))
  }
  const rest = plans.filter((plan) => remaining.has(plan.raw))
  if (rest.length) {
    warnings.push(`未命中分类的命名空间归入 ${config.fallback}：${rest.map((plan) => plan.raw).join("、")}`)
    buckets.push(...packCategory(rest, config.fallback, config, occupied))
  }
  return buckets
}
