import { CONFIG_DEFAULTS } from "./config-defaults"

// 配置写盘：剔除等于默认值的字段，短对象保持单行；是否展开交给项目格式化规范。
// 只影响写盘形态，配置读取语义与生成行为不变。

/** 单行阈值：与接入方 prettier printWidth 对齐，避免工具展开后格式化工具无法再合并 */
const MAX_LINE = 160

/**
 * 判断普通对象。
 * @param value 任意值
 * @return 是否普通对象
 */
function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * 紧凑 JSON：对象与数组用单空格分隔，与项目手写的单行风格一致。
 * @param value 任意值
 * @return 单行文本
 */
function compactJson(value: unknown): string {
  if (Array.isArray(value)) return value.length > 0 ? `[${value.map(compactJson).join(", ")}]` : "[]"
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
    if (entries.length === 0) return "{}"
    return `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${compactJson(item)}`).join(", ")} }`
  }
  return JSON.stringify(value) ?? "null"
}

/**
 * 序列化配置：单行不超过阈值就保持单行。
 * @param value 配置
 * @return 带结尾换行的 JSON 文本
 */
export function stringifyConfig(value: unknown) {
  return `${formatValue(value, "")}\n`
}

/**
 * 递归格式化：标量与短对象单行，长对象逐层展开。
 * @param value 任意值
 * @param indent 当前缩进
 * @return JSON 片段
 */
function formatValue(value: unknown, indent: string): string {
  const single = compactJson(value)
  if (!isPlainObject(value) && !Array.isArray(value)) return single
  if (indent.length + single.length <= MAX_LINE) return single
  const inner = `${indent}  `
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]"
    return `[\n${value.map((item) => `${inner}${formatValue(item, inner)}`).join(",\n")}\n${indent}]`
  }
  const entries = Object.entries(value).filter(([, item]) => item !== undefined)
  if (entries.length === 0) return "{}"
  const lines = entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatValue(item, inner)}`)
  return `{\n${lines.join(",\n")}\n${indent}}`
}

/**
 * 剔除等于默认值的字段。
 * @param config 配置
 * @return 新配置（原对象不变）
 */
export function stripDefaults<T>(config: T): T {
  const result = structuredClone(config)
  const record = result as unknown as Record<string, any>
  stripSectionDefaults(record)
  stripSectionDefaults(record.base)
  for (const doc of Array.isArray(record.docs) ? record.docs : []) stripSectionDefaults(doc)
  return result
}

/**
 * 清理单个配置段（根或文档项）的默认值。
 * @param section 配置段
 * @return 无
 */
function stripSectionDefaults(section: unknown) {
  if (!isPlainObject(section)) return
  if (section.client === CONFIG_DEFAULTS.client) delete section.client
  if (section.language === CONFIG_DEFAULTS.language) delete section.language
  const output = section.output
  if (isPlainObject(output)) {
    for (const [key, value] of Object.entries(CONFIG_DEFAULTS.output)) {
      if (output[key] === value) delete output[key]
    }
    if (Object.keys(output).length === 0) delete section.output
  }
  const input = section.input
  if (isPlainObject(input)) {
    if (input.timeout === CONFIG_DEFAULTS.input.timeout) delete input.timeout
    if (Object.keys(input).length === 0) delete section.input
  }
}
