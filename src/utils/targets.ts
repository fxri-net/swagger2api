import fs from "node:fs"
import path from "node:path"
import { applyEnvOverrides, applyProfile, normalizeConfig } from "./config"

// 多目标配置：defaults 承载公共口径，targets 逐项声明目标标识与各自输入输出。
// 目标内相对路径按配置文件所在目录解析；全部目标在生成前一次性预校验，任一非法则整体退出 2 且不落盘。
/** 单个目标的生效配置 */
export interface TargetConfig {
  /** 目标标识（唯一） */
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

/** 目标解析结果 */
export interface TargetPlan {
  /** 通过校验的目标（保持配置顺序） */
  targets: TargetConfig[]
  /** 配置错误：非空即整体退出，不生成任何目标 */
  errors: string[]
  /** 不影响执行、但需要告知的降级项 */
  warnings: string[]
}

/**
 * 判断值是否为可递归合并的普通对象。
 * @param value 待判断值
 * @return 是否为普通对象
 */
function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * 深度合并：对象逐键递归，数组与其余类型整体替换（后者优先）。
 * @param base 底层配置
 * @param overlay 覆盖层配置
 * @return 合并结果（不修改入参）
 */
export function deepMerge(base: unknown, overlay: unknown): any {
  if (!isPlainObject(base)) return overlay === undefined ? overlay : structuredClone(overlay)
  const result: Record<string, any> = structuredClone(base)
  if (!isPlainObject(overlay)) return result
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? deepMerge(result[key], value) : structuredClone(value)
  }
  return result
}

/**
 * 配置是否声明了 targets（空数组也视为声明，交给预校验报错）。
 * @param config 合并后的配置
 * @return 是否声明
 */
export function hasTargets(config: Record<string, any> | null) {
  return Boolean(config && Object.prototype.hasOwnProperty.call(config, "targets"))
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
 * @param parent 父目录绝对路径
 * @param child 子目录绝对路径
 * @return 是否嵌套
 */
function isNestedPath(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative)
}

/**
 * 解析命令行目标选择：只允许一个 --target。
 * @param argv 参数列表
 * @return 目标 id 与用法错误
 */
export function pickTargetFlag(argv: string[] = process.argv.slice(2)) {
  const values: string[] = []
  argv.forEach((item, index) => {
    if (item === "--target") values.push(argv[index + 1] ?? "")
  })
  if (values.length > 1) return { errors: ["--target 只能指定一个目标 id"] }
  if (values.length === 1 && (!values[0] || values[0].startsWith("-"))) return { errors: ["--target 缺少目标 id"] }
  return { id: values[0] as string | undefined, errors: [] as string[] }
}

/**
 * 解析并预校验全部目标。
 * 合并优先级：命令行 > 环境变量 > profiles > targets 项 > defaults；
 * 分层配置的本地层 / 项目层 / 全局层优先级已在读取时合并完成。
 * @param config 合并后的配置
 * @param options.profile 命名预设
 * @param options.configDir 配置文件所在目录（相对路径基准）
 * @param options.env 环境变量（测试可注入）
 * @return 解析结果
 */
export function resolveTargets(
  config: Record<string, any>,
  options: { profile?: string; configDir: string; env?: Record<string, string | undefined> }
): TargetPlan {
  const errors: string[] = []
  const warnings: string[] = []
  const list = config.targets
  if (!Array.isArray(list) || list.length === 0) return { targets: [], errors: ["targets 必须是非空数组"], warnings }
  if (config.defaults !== undefined && !isPlainObject(config.defaults)) errors.push("defaults 必须是对象")
  const defaults = isPlainObject(config.defaults) ? config.defaults : {}
  const profiles = isPlainObject(config.profiles) ? config.profiles : undefined
  // 根上的目标级字段会被静默忽略，给出明确提示
  for (const key of ["url", "file", "input", "output"]) {
    if (config[key] !== undefined) warnings.push(`多目标配置忽略根上的 ${key}，目标输入输出请写在 targets 或 defaults 内`)
  }

  const seen = new Set<string>()
  const targets: TargetConfig[] = []
  list.forEach((raw, index) => {
    const label = `targets[${index}]`
    if (!isPlainObject(raw)) {
      errors.push(`${label}：必须是对象`)
      return
    }
    const id = typeof raw.id === "string" ? raw.id.trim() : ""
    if (!id) {
      errors.push(`${label}：缺少 id`)
      return
    }
    if (seen.has(id)) {
      errors.push(`目标 id 重复：${id}`)
      return
    }
    seen.add(id)
    // 目标项覆盖 defaults；预设与环境变量最后逐目标覆盖
    const { id: _id, ...rest } = raw
    const withProfiles = { ...deepMerge(defaults, rest), ...(profiles ? { profiles } : {}) }
    // 与单目标一致：归一化 → 套预设 → 再归一化（兼容预设内继续使用扁平字段）→ 环境变量
    const normalized = applyEnvOverrides(normalizeConfig(applyProfile(normalizeConfig(withProfiles), options.profile)), options.env)
    const input = normalized.input ?? {}
    const rawInput = input.url ?? input.file
    if (typeof rawInput !== "string" || !rawInput.trim()) {
      errors.push(`目标 ${id}：缺少 input.url 或 input.file`)
      return
    }
    // URL 原样保留，本地文件按配置目录解析并预检存在性，避免跑到一半才发现
    const resolvedInput = /^https?:\/\//i.test(rawInput) ? rawInput : path.resolve(options.configDir, rawInput)
    if (!/^https?:\/\//i.test(resolvedInput) && !fs.existsSync(resolvedInput)) {
      errors.push(`目标 ${id}：输入文件不存在：${resolvedInput}`)
      return
    }
    const output = normalized.output
    const outputValue = typeof output === "string" ? output : output?.dir ?? "./src/api"
    const outputName = typeof output === "string" ? "index" : output?.name ?? normalized.name ?? "index"
    targets.push({
      id,
      input: resolvedInput,
      outputDir: path.resolve(options.configDir, outputValue),
      name: outputName,
      config: normalized
    })
  })

  // 输出目录必须互不包含：一个目标的清理或清单不能波及另一个目标
  for (let left = 0; left < targets.length; left += 1) {
    for (let right = left + 1; right < targets.length; right += 1) {
      const first = targets[left]
      const second = targets[right]
      if (isSamePath(first.outputDir, second.outputDir)) {
        errors.push(`目标 ${first.id} 与 ${second.id} 的输出目录相同：${first.outputDir}`)
      } else if (isNestedPath(first.outputDir, second.outputDir) || isNestedPath(second.outputDir, first.outputDir)) {
        errors.push(`目标 ${first.id} 与 ${second.id} 的输出目录互相嵌套：${first.outputDir} / ${second.outputDir}`)
      }
    }
  }
  return { targets, errors, warnings }
}
