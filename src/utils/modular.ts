import fs from "node:fs"
import path from "node:path"

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
 * 生成聚合入口内容：各模块实例共享同一个 axios 实例，保持单文件模式的调用形态。
 * @param modules 模块列表
 * @param apiClassName 聚合类名
 * @param modulesDir 模块所在目录（相对导入用）
 * @param toJS 是否为 JS 输出
 * @return 文件内容
 */
export function buildAggregateEntry(modules: ModuleEntry[], apiClassName: string, modulesDir: string, toJS: boolean) {
  const className = apiClassName || "Api"
  const importLines = modules.map((item) => {
    const alias = item.className === className ? `${item.className}Module` : item.className
    const target = `${modulesDir ? `${modulesDir.replace(/\\/g, "/")}/` : ""}${item.base}`
    return `import { ${item.className}${alias === item.className ? "" : ` as ${alias}`} } from "./${target}"`
  })
  const props = modules.map((item) => `${item.property} = new ${item.className === className ? `${item.className}Module` : item.className}()`)
  const setters = modules.map((item) => `    this.${item.property}.instance = this.instance`)
  const lines = [
    `import { HttpClient } from "./http-client"`,
    ...importLines,
    `export * from "./data-contracts"`,
    "",
    "/** 聚合入口：各模块共享同一个请求实例 */",
    `export class ${className}<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {`,
    ...props.map((line) => `  ${line}`),
    "",
    "  constructor(config?: any) {",
    "    super(config)",
    ...setters,
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
 * @return 写入的文件
 */
export function writeAggregateEntry(dir: string, apiClassName: string, toJS: boolean) {
  const ext = toJS ? ".js" : ".ts"
  const modules = collectModules(dir, ext)
  if (modules.length === 0) return []
  const content = buildAggregateEntry(modules, apiClassName, "", toJS)
  const files: string[] = []
  const entry = path.join(dir, `index${ext}`)
  fs.writeFileSync(entry, content)
  files.push(entry)
  if (toJS) {
    const dts = buildAggregateDeclarations(modules, apiClassName)
    const dtsFile = path.join(dir, "index.d.ts")
    fs.writeFileSync(dtsFile, dts)
    files.push(dtsFile)
  }
  return files
}

/**
 * 生成 JS 模式的聚合声明文件。
 * @param modules 模块列表
 * @param apiClassName 聚合类名
 * @return 声明内容
 */
export function buildAggregateDeclarations(modules: ModuleEntry[], apiClassName: string) {
  const className = apiClassName || "Api"
  const imports = modules.map((item) => {
    const alias = item.className === className ? `${item.className}Module` : item.className
    return `import { ${item.className}${alias === item.className ? "" : ` as ${alias}`} } from "./${item.base}"`
  })
  const props = modules.map((item) => {
    const type = item.className === className ? `${item.className}Module` : item.className
    return `  ${item.property}: ${type}`
  })
  return [
    `import { HttpClient } from "./http-client"`,
    ...imports,
    `export * from "./data-contracts"`,
    "",
    `export declare class ${className}<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {`,
    ...props,
    "  constructor(config?: any)",
    "}",
    ""
  ].join("\n")
}
