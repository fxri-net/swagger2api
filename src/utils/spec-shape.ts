/**
 * 文档形态归一：生成前把不完整或非法的结构收敛为可处理形态。
 *
 * 只做生成链依赖的最小约束：根节点、paths、components 与路径项必须是对象；
 * 空文档与 Swagger 2.0 直接给出可读结论，不进入生成器。
 */

/** 形态错误 */
export interface SpecShapeError {
  /** 稳定错误码 */
  code: "E_SPEC_INVALID" | "E_NO_ENDPOINTS"
  /** 可读失败原因 */
  message: string
  /** 可执行的下一步 */
  actions: string[]
}

/** 归一结果 */
export type SpecShapeResult =
  | { ok: true; data: Record<string, any>; warnings: string[] }
  | { ok: false; error: SpecShapeError; warnings: string[] }

/** 文档形态错误的通用下一步 */
const SPEC_ACTIONS = ["确认输入地址指向完整的 OpenAPI 3 JSON 文档", "本地文件请检查是否被截断或指向了错误的文件"]

/**
 * 判断值是否为普通对象（排除 null 与数组）。
 * @param value 任意值
 * @return 是否为普通对象
 */
function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * 归一文档形态：校验根节点、paths 与 components，跳过非法路径项与空组件。
 * @param input 原始文档
 * @return 归一结果；失败时携带稳定错误码与下一步
 */
export function normalizeSpecShape(input: unknown): SpecShapeResult {
  const warnings: string[] = []
  if (!isPlainObject(input)) {
    return { ok: false, warnings, error: { code: "E_SPEC_INVALID", message: "文档根节点必须是对象", actions: SPEC_ACTIONS } }
  }
  const data = input
  // Swagger 2.0 用 definitions 描述契约，生成器只接受 OpenAPI 3
  if (String(data.swagger ?? "").startsWith("2.")) {
    return {
      ok: false,
      warnings,
      error: { code: "E_SPEC_INVALID", message: "当前仅支持 OpenAPI 3 文档；检测到 Swagger 2.0，请先转换为 OpenAPI 3", actions: SPEC_ACTIONS }
    }
  }
  if (!isPlainObject(data.paths)) {
    return { ok: false, warnings, error: { code: "E_SPEC_INVALID", message: "缺少 paths 字段或类型不正确（应为对象）", actions: SPEC_ACTIONS } }
  }
  for (const [route, item] of Object.entries(data.paths)) {
    if (isPlainObject(item)) continue
    warnings.push(`已跳过非法路径项：${route}`)
    delete data.paths[route]
  }
  if (Object.keys(data.paths).length === 0) {
    return {
      ok: false,
      warnings,
      error: { code: "E_NO_ENDPOINTS", message: "文档没有接口（paths 为空）", actions: ["确认文档是否尚未发布接口，或输入地址是否指向了其他文档"] }
    }
  }
  if (data.components === undefined || data.components === null) data.components = {}
  else if (!isPlainObject(data.components)) {
    return { ok: false, warnings, error: { code: "E_SPEC_INVALID", message: "components 必须是对象", actions: SPEC_ACTIONS } }
  }
  for (const [section, value] of Object.entries(data.components)) {
    if (!isPlainObject(value)) {
      warnings.push(`已跳过非法组件分类：components.${section}`)
      delete data.components[section]
      continue
    }
    for (const [name, node] of Object.entries(value)) {
      if (node !== null && node !== undefined) continue
      warnings.push(`已跳过空组件：components.${section}.${name}`)
      delete value[name]
    }
  }
  return { ok: true, data, warnings }
}
