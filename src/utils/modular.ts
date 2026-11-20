import fs from "node:fs"
import path from "node:path"
import { findOrphanModules, type GroupNameInfo } from "./naming"

/** 模块入口信息 */
export interface ModuleEntry {
  /** 文件名（不含扩展名） */
  base: string
  /** 类名（与模板的 pascalCase 一致） */
  className: string
  /** 聚合入口上的属性名 */
  property: string
}

/** 不参与聚合的文件名 */
const RESERVED = new Set(["index", "data-contracts", "http-client"])

/**
 * 首字母大写并去掉分隔符，与模板里的 pascalCase 保持一致。
 * 仅在未提供命名表的兼容场景使用（按路径索引分组时依赖库自行命名）。
 * @param value 原始名称
 * @return 驼峰式名称
 */
export function pascalCase(value: string) {
  return String(value)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

/**
 * 收集输出目录中的模块文件。
 * @param dir 输出目录
 * @param ext 扩展名（含点）
 * @return 模块列表（按名称排序）
 */
export function collectModules(dir: string, ext: string) {
  if (!fs.existsSync(dir)) return []
  const modules: ModuleEntry[] = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(ext) || file.endsWith(`.d${ext}`)) continue
    const base = file.slice(0, -ext.length)
    if (RESERVED.has(base) || base.endsWith("Route")) continue
    const className = pascalCase(base)
    modules.push({ base, className, property: className.charAt(0).toLowerCase() + className.slice(1) })
  }
  return modules.sort((a, b) => a.base.localeCompare(b.base))
}

/**
 * 把命名表转成聚合入口所需的模块列表。
 * @param entries 命名表
 * @return 模块列表
 */
export function toModuleEntries(entries: GroupNameInfo[]) {
  return entries.map((entry) => ({ base: entry.fileName, className: entry.className, property: entry.property }))
}

/**
 * 生成聚合入口内容：模块注入同一个门面实例，实例替换与安全数据对所有组同时生效。
 * @param modules 模块列表
 * @param apiClassName 聚合类名
 * @param modulesDir 模块所在目录（相对导入用）
 * @param toJS 是否为 JS 输出
 * @return 文件内容
 */
export function buildAggregateEntry(modules: ModuleEntry[], apiClassName: string, modulesDir: string, toJS: boolean) {
  const className = apiClassName || "Api"
  const aliasOf = (item: ModuleEntry) => (item.className === className ? `${item.className}Module` : item.className)
  const importLines = modules.map((item) => {
    const target = `${modulesDir ? `${modulesDir.replace(/\\/g, "/")}/` : ""}${item.base}`
    const alias = aliasOf(item)
    return `import { ${item.className}${alias === item.className ? "" : ` as ${alias}`} } from "./${target}"`
  })
  const props = modules.map((item) => `${item.property} = new ${aliasOf(item)}(this)`)
  const lines = [
    "/* eslint-disable */",
    "/* tslint:disable */",
    `import { HttpClient } from "./http-client"`,
    ...importLines,
    `export * from "./data-contracts"`,
    `export * from "./http-client"`,
    "",
    "/** 聚合入口：各模块共享同一个请求实例 */",
    `export class ${className}<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {`,
    ...props.map((line) => `  ${line}`),
    "",
    "  constructor(config?: any) {",
    "    super(config)",
    "  }",
    "}",
    ""
  ]
  return lines.join("\n")
}

/**
 * 写入聚合入口；JS 模式同时写 index.js 与 index.d.ts。
 * @param dir 输出目录
 * @param apiClassName 聚合类名
 * @param toJS 是否为 JS 输出
 * @param modules 模块列表；缺省时按目录扫描（兼容按路径索引分组的旧用法）
 * @return 写入的文件
 */
export function writeAggregateEntry(dir: string, apiClassName: string, toJS: boolean, modules?: ModuleEntry[]) {
  const ext = toJS ? ".js" : ".ts"
  const list = modules ?? collectModules(dir, ext)
  if (list.length === 0) return []
  const content = buildAggregateEntry(list, apiClassName, "", toJS)
  const files: string[] = []
  const entry = path.join(dir, `index${ext}`)
  fs.writeFileSync(entry, content)
  files.push(entry)
  if (toJS) {
    const dts = buildAggregateDeclarations(list, apiClassName)
    const dtsFile = path.join(dir, "index.d.ts")
    fs.writeFileSync(dtsFile, dts)
    files.push(dtsFile)
  }
  return files
}

/**
 * 产物校验门：按命名表核对模块文件、类名与聚合入口，返回错误与表外产物。
 * @param dir 输出目录
 * @param entries 命名表
 * @param toJS 是否为 JS 输出
 * @param options 是否校验聚合入口（聚合入口由本工具后写，需分两阶段校验）
 * @return 错误清单与表外文件
 */
export function verifyGroupedOutput(dir: string, entries: GroupNameInfo[], toJS: boolean, options: { aggregate?: boolean } = {}) {
  const ext = toJS ? ".js" : ".ts"
  const errors: string[] = []
  for (const entry of entries) {
    const file = path.join(dir, `${entry.fileName}${ext}`)
    if (!fs.existsSync(file)) {
      errors.push(`缺少模块文件：期望 ${entry.fileName}${ext}（原始组名 ${entry.raw}）`)
      continue
    }
    const content = fs.readFileSync(file, "utf8")
    if (!content.includes(`class ${entry.className}`)) {
      errors.push(`类名与命名表不一致：${entry.fileName}${ext} 期望 ${entry.className}`)
    }
  }
  if (options.aggregate !== false) {
    const aggregate = path.join(dir, `index${ext}`)
    if (!fs.existsSync(aggregate)) {
      errors.push(`缺少聚合入口：index${ext}`)
    } else {
      const content = fs.readFileSync(aggregate, "utf8")
      for (const entry of entries) {
        if (!content.includes(`${entry.property} = new `)) errors.push(`聚合入口缺少模块挂载：${entry.property}`)
      }
    }
  }
  const orphans = fs.existsSync(dir) ? findOrphanModules(fs.readdirSync(dir), entries, ext) : []
  return { errors, orphans }
}

/**
 * 生成 JS 模式的聚合声明文件。
 * @param modules 模块列表
 * @param apiClassName 聚合类名
 * @return 声明内容
 */
export function buildAggregateDeclarations(modules: ModuleEntry[], apiClassName: string) {
  const className = apiClassName || "Api"
  const aliasOf = (item: ModuleEntry) => (item.className === className ? `${item.className}Module` : item.className)
  const imports = modules.map((item) => {
    const alias = aliasOf(item)
    return `import { ${item.className}${alias === item.className ? "" : ` as ${alias}`} } from "./${item.base}"`
  })
  const props = modules.map((item) => `  ${item.property}: ${aliasOf(item)}`)
  return [
    "/* eslint-disable */",
    "/* tslint:disable */",
    `import { HttpClient } from "./http-client"`,
    ...imports,
    `export * from "./data-contracts"`,
    `export * from "./http-client"`,
    "",
    `export declare class ${className}<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {`,
    ...props,
    "  constructor(config?: any)",
    "}",
    ""
  ].join("\n")
}
