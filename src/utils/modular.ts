import fs from "node:fs"
import path from "node:path"
import type { SplitNamespacePlan } from "./grouping"
import { CLIENT_BASE, LEGACY_OUTPUT_BASES, TYPES_DIR, findOrphanModules, type GroupNameInfo } from "./naming"

/** 模块入口信息 */
export interface ModuleEntry {
  /** 文件名（不含扩展名） */
  base: string
  /** 类名（与模板的 pascalCase 一致） */
  className: string
  /** 聚合入口上的属性名 */
  property: string
  /** 聚合入口的导入来源（分桶/分片时与文件名不同；缺省即 base） */
  importFrom?: string
}

/** 不参与聚合的文件名（折叠键比较，兼容大小写不敏感的文件系统） */
const RESERVED = new Set(["index", "shared", "types", CLIENT_BASE, ...LEGACY_OUTPUT_BASES])

/**
 * 生成横幅：生成器写入文件头，用于判定产物归属。
 * 本工具自行补写的聚合入口、门面与声明同样带上该横幅，保证整目录同源可识别。
 */
export const GENERATED_BANNER = "THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API"
/** 判定横幅时读取的文件头字节数：只读前 1KB，不整文件读取 */
const BANNER_SCAN_BYTES = 1024
/** 本工具自写文件头：与生成器产物同样可被横幅识别 */
const GENERATED_HEADER = ["/* eslint-disable */", "/* tslint:disable */", `/* ## ${GENERATED_BANNER} ## */`]

/**
 * 判断文件是否为生成物：文件头前 1KB 含生成横幅。
 * @param file 文件绝对路径
 * @return 是否为生成物
 */
export function isGeneratedFile(file: string) {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, "r")
    const buffer = Buffer.alloc(BANNER_SCAN_BYTES)
    const read = fs.readSync(fd, buffer, 0, BANNER_SCAN_BYTES, 0)
    return buffer.subarray(0, read).toString("utf8").includes(GENERATED_BANNER)
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/**
 * 递归收集目录下的生成物：只认文件头横幅，跳过硬链接与软链接。
 * @param dir 扫描目录
 * @param base 相对路径基准目录
 * @return 相对路径（统一 / 分隔，排序）
 */
export function collectGeneratedFilesOf(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectGeneratedFilesOf(full, base))
      continue
    }
    if (!entry.isFile() || !isGeneratedFile(full)) continue
    files.push(path.relative(base, full).split(path.sep).join("/"))
  }
  return files.sort()
}

/**
 * 失效产物：目录中含生成横幅、但不在本轮 keep 集合内的文件。
 * @param dir 输出目录
 * @param keep 本轮产物相对路径
 * @return 待清理的相对路径
 */
export function findStaleOutputFiles(dir: string, keep: string[]) {
  const keepSet = new Set(keep)
  return collectGeneratedFilesOf(dir).filter((file) => !keepSet.has(file))
}

/**
 * 按横幅清理失效产物：只删除生成物，手写文件不受影响。
 * @param dir 输出目录
 * @param keep 本轮产物相对路径
 * @return 已删除的相对路径
 */
export function pruneGeneratedOutput(dir: string, keep: string[]) {
  const stale = findStaleOutputFiles(dir, keep)
  for (const file of stale) fs.rmSync(path.join(dir, file))
  return stale
}

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
    if (RESERVED.has(base.toLowerCase()) || base.endsWith("Route")) continue
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
  return entries.map((entry) => ({ base: entry.fileName, className: entry.className, property: entry.property, importFrom: entry.importFrom }))
}

/**
 * 收集本轮实际生成的产物文件（含 JS 模式的声明文件）。
 * 契约文件名与业务文件同源，按命名推导并校验存在；不扫描 types/ 目录，
 * 避免把上一轮遗留（已删除的组 / 分片）的契约当成本轮产物。
 * @param dir 输出目录
 * @param entries 命名表
 * @param toJS 是否为 JS 输出
 * @param extraFiles 额外产物文件名（桶、分片、门面，不含扩展名）
 * @return 已存在的产物文件名（排序）
 */
export function collectGeneratedFiles(dir: string, entries: GroupNameInfo[], toJS: boolean, extraFiles: string[] = []) {
  const ext = toJS ? ".js" : ".ts"
  const names = [
    "index",
    `${TYPES_DIR}/index`,
    CLIENT_BASE,
    "route-types",
    ...entries.flatMap((entry) => [entry.fileName, entry.importFrom ?? entry.fileName]),
    ...extraFiles
  ]
  const candidates = names.flatMap((name) => (toJS ? [`${name}${ext}`, `${name}.d.ts`] : [`${name}${ext}`]))
  // 契约按业务文件拆分，文件名取自模块名；index 与 shared 为固定出口与共享契约
  const contractBases = [...new Set(["index", "shared", ...names.map((name) => name.slice(name.lastIndexOf("/") + 1))])]
  const contracts = contractBases.flatMap((base) => (toJS ? [`${TYPES_DIR}/${base}.d.ts`, `${TYPES_DIR}/${base}.js`] : [`${TYPES_DIR}/${base}.ts`]))
  return [...new Set([...candidates, ...contracts])].filter((file) => fs.existsSync(path.join(dir, file))).sort()
}

/**
 * 清理旧版固定产物：改名后不再生成 data-contracts / http-client，升级时删除残留。
 * @param dir 输出目录
 * @param toJS 是否为 JS 输出
 * @return 已删除的相对路径
 */
export function removeLegacyOutput(dir: string, toJS: boolean) {
  const suffixes = toJS ? [".js", ".d.ts"] : [".ts"]
  const removed: string[] = []
  for (const base of LEGACY_OUTPUT_BASES) {
    for (const suffix of suffixes) {
      const file = `${base}${suffix}`
      if (!fs.existsSync(path.join(dir, file))) continue
      fs.rmSync(path.join(dir, file))
      removed.push(file)
    }
  }
  return removed
}

/**
 * 手写文件护栏：目标文件已存在且不含生成横幅时返回冲突。
 * @param dir 输出目录
 * @param entries 命名表
 * @param toJS 是否为 JS 输出
 * @param extraFiles 额外产物文件名（桶、分片、门面，不含扩展名）
 * @return 冲突文件名
 */
export function findHandwrittenConflicts(dir: string, entries: GroupNameInfo[], toJS: boolean, extraFiles: string[] = []) {
  const ext = toJS ? ".js" : ".ts"
  // 固定产物（客户端底座与契约出口）同样纳入护栏，避免覆盖手写文件
  const bases = new Set([CLIENT_BASE, `${TYPES_DIR}/index`, ...entries.flatMap((entry) => [entry.fileName, entry.importFrom ?? entry.fileName]), ...extraFiles])
  return [...bases]
    .flatMap((base) => (toJS ? [`${base}${ext}`, `${base}.d.ts`] : [`${base}${ext}`]))
    .filter((file) => fs.existsSync(path.join(dir, file)) && !isGeneratedFile(path.join(dir, file)))
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
  // 同源模块（分桶文件）合并为一条 import，避免多命名空间拆成多个文件时重复导入
  const bySource = new Map<string, ModuleEntry[]>()
  for (const item of modules) {
    const source = item.importFrom ?? item.base
    const list = bySource.get(source)
    if (list) list.push(item)
    else bySource.set(source, [item])
  }
  const importLines = [...bySource.entries()].map(([source, items]) => {
    const target = `${modulesDir ? `${modulesDir.replace(/\\/g, "/")}/` : ""}${source}`
    const specifiers = items.map((item) => {
      const alias = aliasOf(item)
      return alias === item.className ? item.className : `${item.className} as ${alias}`
    })
    return `import { ${specifiers.join(", ")} } from "./${target}"`
  })
  const props = modules.map((item) => `${item.property} = new ${aliasOf(item)}(this)`)
  const lines = [
    ...GENERATED_HEADER,
    `import { HttpClient } from "./${CLIENT_BASE}"`,
    ...importLines,
    `export * from "./${TYPES_DIR}"`,
    `export * from "./${CLIENT_BASE}"`,
    "",
    "/** 聚合入口：各模块共享同一个请求实例 */",
    toJS ? `export class ${className} extends HttpClient {` : `export class ${className}<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {`,
    ...props.map((line) => `  ${line}`),
    "",
    toJS ? "  constructor(config) {" : "  constructor(config?: any) {",
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
export function verifyGroupedOutput(
  dir: string,
  entries: GroupNameInfo[],
  toJS: boolean,
  options: { aggregate?: boolean; extraFiles?: string[] } = {}
) {
  const ext = toJS ? ".js" : ".ts"
  const errors: string[] = []
  // 同一来源文件可能承载多个命名空间（桶文件）或一个门面类，按来源去重判定文件存在性
  const bySource = new Map<string, GroupNameInfo[]>()
  for (const entry of entries) {
    const source = entry.importFrom ?? entry.fileName
    const list = bySource.get(source)
    if (list) list.push(entry)
    else bySource.set(source, [entry])
  }
  for (const [source, items] of bySource) {
    const file = path.join(dir, `${source}${ext}`)
    if (!fs.existsSync(file)) {
      items.forEach((entry) => errors.push(`缺少模块文件：期望 ${source}${ext}（原始组名 ${entry.raw}）`))
      continue
    }
    const content = fs.readFileSync(file, "utf8")
    for (const entry of items) {
      if (!content.includes(`class ${entry.className}`)) errors.push(`类名与命名表不一致：${source}${ext} 期望 ${entry.className}`)
    }
  }
  // 固定产物必须落位：改名后模板与生成器不同步会静默产出缺底座的产物
  const fixed = [`${CLIENT_BASE}${ext}`, `${TYPES_DIR}/index${ext}`, ...(toJS ? [`${CLIENT_BASE}.d.ts`, `${TYPES_DIR}/index.d.ts`] : [])]
  for (const file of fixed) {
    if (!fs.existsSync(path.join(dir, file))) errors.push(`缺少固定产物：${file}`)
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
  const orphans = fs.existsSync(dir) ? findOrphanModules(fs.readdirSync(dir), entries, ext, options.extraFiles ?? []) : []
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
  // 声明文件与实现同源：桶文件内的多个类合并到一条 import
  const bySource = new Map<string, ModuleEntry[]>()
  for (const item of modules) {
    const source = item.importFrom ?? item.base
    const list = bySource.get(source)
    if (list) list.push(item)
    else bySource.set(source, [item])
  }
  const imports = [...bySource.entries()].map(([source, items]) => {
    const specifiers = items.map((item) => {
      const alias = aliasOf(item)
      return alias === item.className ? item.className : `${item.className} as ${alias}`
    })
    return `import { ${specifiers.join(", ")} } from "./${source}"`
  })
  const props = modules.map((item) => `  ${item.property}: ${aliasOf(item)}`)
  return [
    ...GENERATED_HEADER,
    `import { HttpClient } from "./${CLIENT_BASE}"`,
    ...imports,
    `export * from "./${TYPES_DIR}"`,
    `export * from "./${CLIENT_BASE}"`,
    "",
    `export declare class ${className}<SecurityDataType = unknown> extends HttpClient<SecurityDataType> {`,
    ...props,
    "  constructor(config?: any)",
    "}",
    ""
  ].join("\n")
}

/** 分片门面 */
export interface SplitFacade {
  /** 门面文件名（不含扩展名） */
  fileName: string
  /** 门面类名 */
  className: string
  /** 原始命名空间名（JSDoc 展示） */
  title: string
  /** 分片类 */
  chunks: Array<{ fileName: string; className: string }>
}

/**
 * 从规划结果提取需要写门面的命名空间（仅分片）。
 * @param namespaces 命名空间规划
 * @return 门面列表
 */
export function toSplitFacades(namespaces: SplitNamespacePlan[]): SplitFacade[] {
  return namespaces
    .filter((plan) => plan.chunks.length > 0)
    .map((plan) => ({
      fileName: plan.fileName,
      className: plan.className,
      title: plan.raw,
      chunks: plan.chunks.map((chunk) => ({ fileName: chunk.fileName, className: chunk.className }))
    }))
}

/**
 * 生成分片门面的 TypeScript 内容：实例合并 + 类型合并，对外与单文件产物一致。
 * @param facade 门面
 * @return 文件内容
 */
export function buildSplitFacade(facade: SplitFacade) {
  const imports = facade.chunks.map((chunk) => `import { ${chunk.className} } from "./${chunk.fileName}"`)
  const sources = facade.chunks.map((chunk) => `new ${chunk.className}(http)`).join(", ")
  const extendsList = facade.chunks.map((chunk) => `${chunk.className}<SecurityDataType>`).join(", ")
  return [
    ...GENERATED_HEADER,
    `import { HttpClient } from "./${CLIENT_BASE}"`,
    ...imports,
    "",
    `/** ${facade.title} 模块：由分片合并，对外与单文件产物一致 */`,
    `export class ${facade.className}<SecurityDataType = unknown> {`,
    "  /** 共享请求器：由聚合入口注入；仅供模块内部调用，勿在业务侧直接使用 */",
    "  http: HttpClient<SecurityDataType>",
    "",
    "  constructor(http: HttpClient<SecurityDataType>) {",
    "    this.http = http",
    `    Object.assign(this, ${sources})`,
    "  }",
    "",
    "  /** 底层请求实例：与聚合入口保持同一个 */",
    `  get instance(): HttpClient<SecurityDataType>["instance"] {`,
    "    return this.http.instance",
    "  }",
    "}",
    "",
    "/** 类型合并：分片成员与单文件产物保持同一命名空间 */",
    `export interface ${facade.className}<SecurityDataType = unknown> extends ${extendsList} {}`,
    ""
  ].join("\n")
}

/**
 * 生成分片门面的 JavaScript 内容。
 * @param facade 门面
 * @return 文件内容
 */
export function buildSplitFacadeJs(facade: SplitFacade) {
  const imports = facade.chunks.map((chunk) => `import { ${chunk.className} } from "./${chunk.fileName}"`)
  const sources = facade.chunks.map((chunk) => `new ${chunk.className}(http)`).join(", ")
  return [
    ...GENERATED_HEADER,
    ...imports,
    "",
    `/** ${facade.title} 模块：由分片合并，对外与单文件产物一致 */`,
    `export class ${facade.className} {`,
    "  constructor(http) {",
    "    this.http = http",
    `    Object.assign(this, ${sources})`,
    "  }",
    "",
    "  get instance() {",
    "    return this.http.instance",
    "  }",
    "}",
    ""
  ].join("\n")
}

/**
 * 生成分片门面的声明内容。
 * @param facade 门面
 * @return 声明内容
 */
export function buildSplitFacadeDeclarations(facade: SplitFacade) {
  const imports = facade.chunks.map((chunk) => `import { ${chunk.className} } from "./${chunk.fileName}"`)
  const extendsList = facade.chunks.map((chunk) => `${chunk.className}<SecurityDataType>`).join(", ")
  return [
    ...GENERATED_HEADER,
    `import { HttpClient } from "./${CLIENT_BASE}"`,
    ...imports,
    "",
    `export interface ${facade.className}<SecurityDataType = unknown> extends ${extendsList} {}`,
    `export declare class ${facade.className}<SecurityDataType = unknown> {`,
    "  constructor(http: HttpClient<SecurityDataType>)",
    "}",
    ""
  ].join("\n")
}

/**
 * 写入分片门面：TS 模式写一个文件，JS 模式同时写实现与声明。
 * @param dir 输出目录
 * @param namespaces 命名空间规划
 * @param toJS 是否为 JS 输出
 * @return 写入的文件名
 */
export function writeSplitFacades(dir: string, namespaces: SplitNamespacePlan[], toJS: boolean) {
  const files: string[] = []
  for (const facade of toSplitFacades(namespaces)) {
    if (toJS) {
      const js = `${facade.fileName}.js`
      fs.writeFileSync(path.join(dir, js), buildSplitFacadeJs(facade))
      files.push(js)
      const dts = `${facade.fileName}.d.ts`
      fs.writeFileSync(path.join(dir, dts), buildSplitFacadeDeclarations(facade))
      files.push(dts)
    } else {
      const ts = `${facade.fileName}.ts`
      fs.writeFileSync(path.join(dir, ts), buildSplitFacade(facade))
      files.push(ts)
    }
  }
  return files
}
