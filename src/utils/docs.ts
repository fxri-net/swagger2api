import fs from "node:fs"
import path from "node:path"
import { applyEnvOverrides, applyProfileToBase, deepMergeConfig, normalizeDocConfig } from "./config"

// 文档列表：base 提供共享配置，docs 逐项声明输入输出；所有文档在读配置时一次性预校验，
// 任一非法则整体退出，不生成半批产物。

/** 单个文档的生效配置 */
export interface DocConfig {
  /** 文档标识（唯一） */
  id: string
  /** 已解析的输入地址（URL 或绝对路径） */
  input: string
  /** 输出目录绝对路径 */
  outputDir: string
  /** 生成入口文件名 */
  name: string
  /** 归一化后的完整配置 */
  config: Record<string, any>
}

/** 文档解析结果 */
export interface DocPlan {
  /** 通过校验的文档（保持配置顺序） */
  docs: DocConfig[]
  /** 配置错误：非空即整体退出，不生成任何文档 */
  errors: string[]
  /** 不影响执行、但需要告知的降级项 */
  warnings: string[]
}

/** 文档 id 允许的字符 */
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/**
 * 判断是否为可递归合并的普通对象。
 * @param value 任意值
 * @return 是否普通对象
 */
function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * 判断两个路径是否相同（Windows 不区分大小写）。
 * @param left 绝对路径
 * @param right 绝对路径
 * @return 是否相同
 */
function isSamePath(left: string, right: string) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right
}

/**
 * 判断 child 是否位于 parent 之内（不含相同目录）。
 * @param parent 父目录
 * @param child 子目录
 * @return 是否嵌套
 */
function isNestedPath(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative)
}

/**
 * 配置是否声明了 docs。
 * @param config 合并后的配置
 * @return 是否声明
 */
export function hasDocs(config: Record<string, any> | null) {
  return Boolean(config && Array.isArray(config.docs))
}

/**
 * 解析命令行文档选择：--target 支持逗号与重复传参，--all 表示全选。
 * @param argv 参数列表
 * @return 选择结果与用法错误
 */
export function pickDocFlags(argv: string[] = process.argv.slice(2)) {
  const values: string[] = []
  argv.forEach((item, index) => {
    if (item === "--target") values.push(argv[index + 1] ?? "")
  })
  const errors: string[] = []
  const ids = [...new Set(values.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))]
  if (values.some((value) => !value || value.startsWith("-"))) errors.push("--target 缺少文档 id")
  const all = argv.includes("--all")
  if (all && values.length > 0) errors.push("--target 与 --all 不能同时使用")
  return { ids, all, errors }
}

/** 文档选择结果 */
export interface DocSelection {
  /** 本次要执行的文档（run 时有值） */
  docs: DocConfig[]
  /** 用法错误：非空即退出 2 */
  errors: string[]
  /** run：直接执行；prompt：交互选择；required：非交互必须显式指定 */
  action: "run" | "prompt" | "required"
}

/**
 * 解析命令行选择与交互策略：单文档直接执行，多文档按 --all / --target / 交互顺序决定。
 * @param docs 已校验的文档
 * @param picked 命令行选择
 * @param options.interactive 是否允许交互
 * @return 选择结果
 */
export function selectDocs(docs: DocConfig[], picked: { ids: string[]; all: boolean; errors: string[] }, options: { interactive: boolean }): DocSelection {
  if (picked.errors.length > 0) return { docs: [], errors: picked.errors, action: "required" }
  if (picked.all) return { docs, errors: [], action: "run" }
  if (picked.ids.length > 0) {
    const known = new Set(docs.map((doc) => doc.id))
    const unknown = picked.ids.filter((id) => !known.has(id))
    if (unknown.length > 0) {
      return { docs: [], errors: [`未知文档 ${unknown.join("、")}（可选：${docs.map((doc) => doc.id).join("、")}）`], action: "required" }
    }
    return { docs: docs.filter((doc) => picked.ids.includes(doc.id)), errors: [], action: "run" }
  }
  if (docs.length === 1) return { docs, errors: [], action: "run" }
  return { docs: [], errors: [], action: options.interactive ? "prompt" : "required" }
}

/**
 * 解析并预校验全部文档。
 * 合并优先级：命令行 > 环境变量 > profile > 文档项 > base。
 * @param config 合并后的配置
 * @param options.profile 命名预设
 * @param options.configDir 配置文件所在目录（相对路径基准）
 * @param options.env 环境变量（测试可注入）
 * @return 解析结果
 */
export function resolveDocs(
  config: Record<string, any>,
  options: { profile?: string; configDir: string; env?: Record<string, string | undefined> }
): DocPlan {
  const errors: string[] = []
  const warnings: string[] = []
  const list = config?.docs
  if (!Array.isArray(list) || list.length === 0) return { docs: [], errors: ["docs 必须是非空数组"], warnings }
  if (config.base !== undefined && !isPlainObject(config.base)) errors.push("base 必须是对象")
  const base = isPlainObject(config.base) ? config.base : {}
  if (base.source !== undefined) errors.push("base 不允许声明 source，请写在 docs 项内")
  if (base.output !== undefined && !isPlainObject(base.output)) errors.push("base.output 必须是对象")
  if (isPlainObject(base.output) && base.output.dir !== undefined) errors.push("base.output 不允许声明 dir，输出目录请写在 docs 项内")
  const profiles = isPlainObject(config.profiles) ? config.profiles : undefined
  const mergedBase = applyProfileToBase(base, profiles, options.profile)
  const baseOutput = isPlainObject(mergedBase.output) ? mergedBase.output : {}
  const baseRest = { ...mergedBase }
  delete baseRest.output

  const seen = new Set<string>()
  const docs: DocConfig[] = []
  list.forEach((raw, index) => {
    const label = `docs[${index}]`
    if (!isPlainObject(raw)) {
      errors.push(`${label}：必须是对象`)
      return
    }
    const id = typeof raw.id === "string" ? raw.id.trim() : ""
    if (!id) {
      errors.push(`${label}：缺少 id`)
      return
    }
    if (!DOC_ID.test(id)) {
      errors.push(`${label}：id 只允许字母、数字、下划线、短横线，且不能以符号开头：${id}`)
      return
    }
    if (seen.has(id)) {
      errors.push(`文档 id 重复：${id}`)
      return
    }
    seen.add(id)
    const source = raw.source
    if (typeof source !== "string" && !isPlainObject(source)) {
      errors.push(`文档 ${id}：缺少 source（字符串或 { url | file }）`)
      return
    }
    const outputRaw = raw.output
    if (typeof outputRaw !== "string" && !isPlainObject(outputRaw)) {
      errors.push(`文档 ${id}：缺少 output（目录字符串或对象）`)
      return
    }
    const { id: _id, source: _source, output: _output, ...rest } = raw
    const docOutput = typeof outputRaw === "string" ? { dir: outputRaw } : outputRaw
    const merged = deepMergeConfig(baseRest, rest)
    merged.source = source
    merged.output = deepMergeConfig(baseOutput, docOutput)
    const normalized = applyEnvOverrides(normalizeDocConfig(merged), options.env)
    const input = normalized.input ?? {}
    const rawInput = input.url ?? input.file
    if (typeof rawInput !== "string" || !rawInput.trim()) {
      errors.push(`文档 ${id}：source 缺少 url 或 file`)
      return
    }
    const resolvedInput = /^https?:\/\//i.test(rawInput) ? rawInput : path.resolve(options.configDir, rawInput)
    if (!/^https?:\/\//i.test(resolvedInput) && !fs.existsSync(resolvedInput)) {
      errors.push(`文档 ${id}：输入文件不存在：${resolvedInput}`)
      return
    }
    const output = normalized.output ?? {}
    if (typeof output.dir !== "string" || !output.dir.trim()) {
      errors.push(`文档 ${id}：output.dir 不能为空`)
      return
    }
    const name = typeof output.name === "string" ? output.name.trim() : ""
    if (!name) {
      errors.push(`文档 ${id}：output.name 不能为空`)
      return
    }
    // 入口名只作为文件名，路径与扩展名由工具决定
    if (/[\\/]/.test(name) || /\.[^./\\]+$/.test(name)) {
      errors.push(`文档 ${id}：output.name 不能包含路径分隔符或扩展名：${name}`)
      return
    }
    docs.push({
      id,
      input: resolvedInput,
      outputDir: path.resolve(options.configDir, output.dir),
      name,
      config: normalized
    })
  })

  // 输出目录必须互不包含：一个文档的清理不能波及另一个
  for (let left = 0; left < docs.length; left += 1) {
    for (let right = left + 1; right < docs.length; right += 1) {
      const first = docs[left]
      const second = docs[right]
      if (isSamePath(first.outputDir, second.outputDir)) {
        errors.push(`文档 ${first.id} 与 ${second.id} 的输出目录相同：${first.outputDir}`)
      } else if (isNestedPath(first.outputDir, second.outputDir) || isNestedPath(second.outputDir, first.outputDir)) {
        errors.push(`文档 ${first.id} 与 ${second.id} 的输出目录互相嵌套：${first.outputDir} / ${second.outputDir}`)
      }
    }
  }
  return { docs, errors, warnings }
}
