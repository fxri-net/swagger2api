import fs from "node:fs"
import path from "node:path"
import { loadConfigLayers } from "./config"

// 产物布局审计：只读扫描生成目录，按分桶口径报告模块体量与异常。
// 不依赖 Swagger 文档、不联网、不读生成清单，用于离线产物与手改后的机械兜底。

/** 审计阈值：与分组配置 grouping.split 的默认值保持一致 */
export interface InspectThresholds {
  /** 是否启用自适应分桶判据；false 表示显式选择一组一文件，跳过布局判据 */
  enabled: boolean
  /** 总量不超过该值时默认只生成一个模块文件 */
  minRoutes: number
  /** 单桶目标体量 */
  targetRoutes: number
  /** 单桶硬上限，超过时按子分类分片 */
  maxRoutes: number
  /** 桶体量下限，低于该值的桶应并入相邻桶 */
  minBucketRoutes: number
}

/** 默认阈值：与 grouping.split 归一化后的默认值同源 */
export const DEFAULT_INSPECT_THRESHOLDS: InspectThresholds = {
  enabled: true,
  minRoutes: 150,
  targetRoutes: 300,
  maxRoutes: 450,
  minBucketRoutes: 60
}

/** 单个模块文件的审计结果 */
export interface ModuleReport {
  /** 文件名 */
  file: string
  /** 请求方法数 */
  routes: number
  /** 导出的类名 */
  classes: string[]
  /** 文件字节数 */
  bytes: number
  /** 是否为分片门面（0 个自有方法、仅合并分片实例） */
  facade: boolean
  /** 分片号；非分片为 null */
  shard: string | null
}

/** 目录审计报告 */
export interface InspectReport {
  /** 产物目录 */
  dir: string
  /** 布局模式：grouped / single */
  mode: "grouped" | "single"
  /** 模块文件总数 */
  modules: ModuleReport[]
  /** 请求总数 */
  total: number
  /** 需要修复的异常 */
  issues: string[]
  /** 可接受但值得关注的提示 */
  hints: string[]
}

/** 统计请求方法数：兼容 JS / TS 泛型 / 旧版单文件三种形态 */
const REQUEST_PATTERN = /this\.(?:http\.)?request[<(]/g
/** 导出的类名 */
const CLASS_PATTERN = /^export class ([A-Za-z_$][\w$]*)/gm
/** 固定产物 */
const FIXED_FILES = ["index", "client"]
/** 分片门面的实例合并特征 */
const FACADE_PATTERN = /Object\.assign\(this,\s*new\s+[A-Za-z_$][\w$]*\(http\)/
/** 分片文件名后缀 */
const SHARD_PATTERN = /^(.+?)Part(\d+)$/

/**
 * 把分组配置里的 split 值归一为审计阈值。
 * @param split grouping.split 的原始值
 * @return 审计阈值
 */
export function inspectThresholdsOf(split: unknown): InspectThresholds {
  if (split === false) return { ...DEFAULT_INSPECT_THRESHOLDS, enabled: false }
  if (!split || typeof split !== "object") return { ...DEFAULT_INSPECT_THRESHOLDS }
  const source = split as Record<string, unknown>
  const pick = (key: keyof InspectThresholds) => {
    const value = source[key]
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : (DEFAULT_INSPECT_THRESHOLDS[key] as number)
  }
  return {
    enabled: true,
    minRoutes: pick("minRoutes"),
    targetRoutes: pick("targetRoutes"),
    maxRoutes: pick("maxRoutes"),
    minBucketRoutes: pick("minBucketRoutes")
  }
}

/**
 * 从配置分层解析审计阈值：取 base.grouping.split。
 * @param options.projectFile 显式项目层配置；缺省按当前目录向上查找
 * @param options.cwd 起始目录
 * @return 审计阈值
 */
export function resolveInspectThresholds(options: { projectFile?: string; cwd?: string } = {}): InspectThresholds {
  const layers = loadConfigLayers(options.cwd ?? process.cwd(), { projectFile: options.projectFile })
  const merged = layers.merged as Record<string, any> | null
  return inspectThresholdsOf(merged?.base?.grouping?.split)
}

/**
 * 读取目录的顶层代码文件（不含声明文件、聚合入口与客户端）。
 * @param dir 产物目录
 * @return 模块文件名列表
 */
function moduleFiles(dir: string) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:js|ts)$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
    .map((entry) => entry.name)
    .filter((name) => !FIXED_FILES.includes(path.basename(name, path.extname(name))))
    .sort()
}

/**
 * 判断固定产物是否存在（.ts / .js 任一）。
 * @param dir 产物目录
 * @param base 文件基名
 * @return 是否存在
 */
function hasFixed(dir: string, base: string) {
  return fs.existsSync(path.join(dir, `${base}.ts`)) || fs.existsSync(path.join(dir, `${base}.js`))
}

/**
 * 审计产物目录的模块布局。
 * @param dir 产物目录
 * @param thresholds 审计阈值
 * @return 审计报告
 */
export function inspectLayout(dir: string, thresholds: InspectThresholds = DEFAULT_INSPECT_THRESHOLDS): InspectReport {
  if (!fs.existsSync(dir)) throw new Error(`产物目录不存在：${dir}`)
  const files = moduleFiles(dir)
  const modules: ModuleReport[] = files.map((file) => {
    const full = path.join(dir, file)
    const text = fs.readFileSync(full, "utf8")
    const routes = (text.match(REQUEST_PATTERN) || []).length
    const classes = [...text.matchAll(CLASS_PATTERN)].map((match) => match[1])
    const base = path.basename(file, path.extname(file))
    const shard = SHARD_PATTERN.exec(base)?.[2] ?? null
    return {
      file,
      routes,
      classes,
      bytes: fs.statSync(full).size,
      facade: routes === 0 && FACADE_PATTERN.test(text),
      shard
    }
  })
  const total = modules.reduce((sum, item) => sum + item.routes, 0)
  const mode: InspectReport["mode"] = hasFixed(dir, "client") ? "grouped" : "single"
  const issues: string[] = []
  const hints: string[] = []
  if (mode === "grouped") {
    for (const file of FIXED_FILES) {
      if (!hasFixed(dir, file)) issues.push(`缺少固定产物：${file}.ts / ${file}.js`)
    }
    if (!fs.existsSync(path.join(dir, "types"))) issues.push("缺少固定产物目录：types/")
  }
  if (mode === "grouped" && thresholds.enabled) {
    if (modules.length > 1 && total <= thresholds.minRoutes) {
      hints.push(`总量 ${total} ≤ minRoutes（${thresholds.minRoutes}），默认应只生成一个模块文件`)
    }
    for (const item of modules) {
      if (item.facade) continue
      if (item.shard && item.routes < thresholds.minBucketRoutes) {
        hints.push(`分片余量偏小：${item.file} 仅 ${item.routes} 条，可在上限内回填上一片`)
        continue
      }
      if (item.routes > 0 && item.routes < thresholds.minBucketRoutes) {
        issues.push(`模块文件偏小：${item.file} 仅 ${item.routes} 条（< 下限 ${thresholds.minBucketRoutes}），应并入相邻桶`)
      }
      if (item.routes > thresholds.maxRoutes) {
        issues.push(`模块文件超过上限：${item.file} 有 ${item.routes} 条（> 上限 ${thresholds.maxRoutes}），应分片`)
      }
    }
  }
  return { dir, mode, modules, total, issues, hints }
}

/**
 * 格式化审计报告为文本行。
 * @param report 审计报告
 * @return 文本行
 */
export function formatInspectReport(report: InspectReport) {
  const lines = [
    `产物布局审计：${report.dir}`,
    `  模式 ${report.mode}，模块文件 ${report.modules.length} 个，请求 ${report.total} 条`
  ]
  for (const item of report.modules) {
    const tags = [item.facade ? "门面" : "", item.shard ? `Part${item.shard}` : ""].filter(Boolean).join(" ")
    lines.push(`  ${item.file}：${item.routes} 条，${item.classes.length} 类${tags ? `（${tags}）` : ""}`)
  }
  if (report.issues.length) {
    lines.push("问题：")
    report.issues.forEach((issue) => lines.push(`  ✖ ${issue}`))
  }
  if (report.hints.length) {
    lines.push("提示：")
    report.hints.forEach((hint) => lines.push(`  · ${hint}`))
  }
  if (!report.issues.length && !report.hints.length) lines.push("布局符合分桶口径")
  return lines
}
