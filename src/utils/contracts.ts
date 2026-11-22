import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { generatedHeader, type BannerLanguage } from "./banner"
import { isGeneratedFile } from "./modular"
import { SHARED_BASE, TYPES_DIR } from "./naming"

/** 契约顶层声明 */
export interface ContractDeclaration {
  /** 声明名 */
  name: string
  /** 是否为运行时值（枚举） */
  value: boolean
  /** 是否原本对外导出 */
  exported: boolean
  /** 声明文本（含前导注释；内部声明已补 export） */
  text: string
  /** 引用的其他契约名 */
  refs: Set<string>
}

/** 契约源文件解析结果 */
export interface ContractSource {
  /** 文件头注释（lint 开关与版权 banner） */
  header: string
  /** 顶层声明（保持源码顺序） */
  declarations: ContractDeclaration[]
}

/** 拆分输出 */
export interface ContractSplitResult {
  /** 写入的相对路径（相对输出目录，统一 / 分隔） */
  written: string[]
  /** 阻断性错误（手写文件冲突等） */
  errors: string[]
}

/** 契约出口的相对模块名（生成器按此导入） */
const TYPES_ENTRY = `${TYPES_DIR}/index`

/**
 * 判断语句是否为契约顶层声明。
 * @param statement 语句
 * @return 是否声明
 */
function isDeclarationStatement(statement: ts.Statement) {
  return (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isFunctionDeclaration(statement) ||
    ts.isVariableStatement(statement)
  )
}

/**
 * 取声明名；无法命名的语句返回 null。
 * @param statement 语句
 * @return 声明名
 */
function declarationName(statement: ts.Statement) {
  if (ts.isVariableStatement(statement)) {
    const declaration = statement.declarationList.declarations[0]
    return declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : null
  }
  const named = statement as ts.Statement & { name?: ts.Node }
  return named.name && ts.isIdentifier(named.name) ? named.name.text : null
}

/**
 * 判断语句是否带 export。
 * @param statement 语句
 * @return 是否导出
 */
function isExported(statement: ts.Statement) {
  if (!ts.canHaveModifiers(statement)) return false
  return Boolean(ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

/**
 * 创建仅包含单个契约文件的编译环境，供 checker 解析标识符。
 * @param fileName 虚拟文件名
 * @param source 文件内容
 * @return 源文件与 checker
 */
function createChecker(fileName: string, source: string) {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    noResolve: true,
    skipLibCheck: true,
    noEmit: true
  }
  const host = ts.createCompilerHost(options)
  const originalGetSourceFile = host.getSourceFile.bind(host)
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === fileName ? sourceFile : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram({ rootNames: [fileName], options, host })
  return { sourceFile, checker: program.getTypeChecker() }
}

/**
 * 解析契约文件：提取头部注释、顶层声明、声明引用与是否运行时值。
 * 引用用 TypeScript checker 解析，避免属性名与类型同名时误判。
 * @param source 文件内容
 * @param fileName 虚拟文件名
 * @return 解析结果
 */
export function parseContractSource(source: string, fileName = `${TYPES_DIR}/index.ts`): ContractSource {
  const { sourceFile, checker } = createChecker(fileName, source)
  const nodeNames = new Map<ts.Node, string>()
  const statements = sourceFile.statements.filter(isDeclarationStatement)
  const names = new Set<string>()
  for (const statement of statements) {
    const name = declarationName(statement)
    if (!name) continue
    nodeNames.set(statement, name)
    names.add(name)
  }
  const first = sourceFile.statements[0]
  const header = first ? source.slice(0, first.getStart(sourceFile)).trimEnd() : ""
  const declarations: ContractDeclaration[] = []
  for (const statement of statements) {
    const name = declarationName(statement)
    if (!name) continue
    const exported = isExported(statement)
    const start = statement.getStart(sourceFile, true)
    const keywordStart = statement.getStart(sourceFile) - start
    const raw = source.slice(start, statement.getEnd())
    // 内部声明补 export，拆分后才能被其他类型文件引用；是否对外由 barrel 决定
    const text = exported ? raw : `${raw.slice(0, keywordStart)}export ${raw.slice(keywordStart)}`
    const refs = new Set<string>()
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && node.text !== name && names.has(node.text)) {
        const symbol = checker.getSymbolAtLocation(node)
        const target = symbol?.declarations?.find((item) => nodeNames.has(item))
        const ref = target ? nodeNames.get(target) : undefined
        if (ref && ref !== name) refs.add(ref)
      }
      ts.forEachChild(node, visit)
    }
    visit(statement)
    declarations.push({ name, value: ts.isEnumDeclaration(statement), exported, text, refs })
  }
  return { header, declarations }
}

/**
 * 读取模块文件从契约出口导入的名称。
 * @param source 模块文件内容
 * @param fileName 虚拟文件名
 * @return 导入的契约名
 */
export function collectContractImports(source: string, fileName = "module.ts") {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    if (!specifier.endsWith(TYPES_ENTRY)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) names.add((element.propertyName ?? element.name).text)
  }
  return names
}

/**
 * 规划契约归属：按模块导入计算使用方集合，再沿引用关系传递闭包。
 * 互引的环最终得到同一使用方集合，因而不会被拆到不同文件，保证类型文件之间无环。
 * @param declarations 契约声明
 * @param modules 模块文件（文件名不含扩展名 + 内容）
 * @return 声明名 → 归属文件（不含扩展名）
 */
export function planContractOwnership(declarations: ContractDeclaration[], modules: Array<{ file: string; source: string }>) {
  const names = new Set(declarations.map((declaration) => declaration.name))
  const owners = new Map<string, Set<string>>()
  for (const declaration of declarations) owners.set(declaration.name, new Set())
  for (const module of modules) {
    for (const name of collectContractImports(module.source, `${module.file}.ts`)) {
      if (names.has(name)) owners.get(name)?.add(module.file)
    }
  }
  // 固定点：被引用的声明继承引用方的使用方集合
  let changed = true
  while (changed) {
    changed = false
    for (const declaration of declarations) {
      const users = owners.get(declaration.name)
      if (!users) continue
      for (const ref of declaration.refs) {
        const target = owners.get(ref)
        if (!target) continue
        for (const user of users) {
          if (target.has(user)) continue
          target.add(user)
          changed = true
        }
      }
    }
  }
  const result = new Map<string, string>()
  for (const declaration of declarations) {
    const users = owners.get(declaration.name) ?? new Set<string>()
    result.set(declaration.name, users.size === 1 ? [...users][0] : SHARED_BASE)
  }
  return result
}

/**
 * 生成单个类型文件的导入语句。
 * @param file 当前文件名（不含扩展名）
 * @param declarations 本文件声明
 * @param owners 归属表
 * @param values 运行时值集合
 * @param dts 是否为声明文件
 * @return 导入行
 */
function buildImports(file: string, declarations: ContractDeclaration[], owners: Map<string, string>, values: Set<string>, dts: boolean) {
  const bySource = new Map<string, { values: string[]; types: string[] }>()
  for (const declaration of declarations) {
    for (const ref of declaration.refs) {
      const owner = owners.get(ref)
      if (!owner || owner === file) continue
      const bucket = bySource.get(owner) ?? { values: [], types: [] }
      // 声明文件只承载类型位置，统一用 import type；TS 文件里枚举按值导入
      if (!dts && values.has(ref)) bucket.values.push(ref)
      else bucket.types.push(ref)
      bySource.set(owner, bucket)
    }
  }
  const lines: string[] = []
  for (const [source, bucket] of [...bySource.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (bucket.values.length) lines.push(`import { ${[...new Set(bucket.values)].sort().join(", ")} } from "./${source}"`)
    if (bucket.types.length) lines.push(`import type { ${[...new Set(bucket.types)].sort().join(", ")} } from "./${source}"`)
  }
  return lines
}

/**
 * 生成 barrel：只导出原本公开的声明，内部声明留在文件内不进入对外面。
 * @param declarations 契约声明
 * @param owners 归属表
 * @param options 输出形态
 * @return barrel 内容
 */
function buildBarrel(declarations: ContractDeclaration[], owners: Map<string, string>, options: { runtimeOnly: boolean }) {
  const bySource = new Map<string, { values: string[]; types: string[] }>()
  for (const declaration of declarations) {
    if (!declaration.exported) continue
    // JS 实现文件只承载运行时枚举
    if (options.runtimeOnly && !declaration.value) continue
    const owner = owners.get(declaration.name) ?? SHARED_BASE
    const bucket = bySource.get(owner) ?? { values: [], types: [] }
    if (declaration.value) bucket.values.push(declaration.name)
    else bucket.types.push(declaration.name)
    bySource.set(owner, bucket)
  }
  const lines: string[] = []
  for (const [source, bucket] of [...bySource.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (bucket.values.length) lines.push(`export { ${bucket.values.join(", ")} } from "./${source}"`)
    if (bucket.types.length) lines.push(`export type { ${bucket.types.join(", ")} } from "./${source}"`)
  }
  return lines
}

/**
 * 按归属生成类型文件与 barrel（不含落盘）。
 * @param source 契约源
 * @param owners 归属表
 * @param options 输出形态
 * @return 文件名（不含扩展名）→ 内容
 */
export function buildContractFiles(source: ContractSource, owners: Map<string, string>, options: { toJS: boolean }) {
  const groups = new Map<string, ContractDeclaration[]>()
  for (const declaration of source.declarations) {
    const owner = owners.get(declaration.name) ?? SHARED_BASE
    const list = groups.get(owner)
    if (list) list.push(declaration)
    else groups.set(owner, [declaration])
  }
  const values = new Set(source.declarations.filter((declaration) => declaration.value).map((declaration) => declaration.name))
  const files = new Map<string, string>()
  const header = source.header ? `${source.header}\n` : ""
  const declarationExt = options.toJS ? ".d.ts" : ".ts"
  for (const [file, declarations] of groups) {
    const imports = buildImports(file, declarations, owners, values, options.toJS)
    const body = declarations.map((declaration) => declaration.text.trimEnd()).join("\n\n")
    files.set(`${file}${declarationExt}`, [header, imports.length ? `${imports.join("\n")}\n` : "", body, ""].filter(Boolean).join("\n"))
  }
  if (options.toJS) {
    files.set("index.js", [header, ...buildBarrel(source.declarations, owners, { runtimeOnly: true }), ""].filter(Boolean).join("\n"))
    files.set("index.d.ts", [header, ...buildBarrel(source.declarations, owners, { runtimeOnly: false }), ""].filter(Boolean).join("\n"))
  } else {
    files.set("index.ts", [header, ...buildBarrel(source.declarations, owners, { runtimeOnly: false }), ""].filter(Boolean).join("\n"))
  }
  return files
}

/**
 * 拆出 JS 实现文件里的运行时枚举（export var + IIFE 成对出现）。
 * @param source 契约实现文件内容
 * @return 枚举名 → 代码
 */
export function parseRuntimeEnums(source: string) {
  const sourceFile = ts.createSourceFile(`${TYPES_ENTRY}.js`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const groups = new Map<string, string>()
  for (let index = 0; index < sourceFile.statements.length; index += 1) {
    const statement = sourceFile.statements[index]
    if (!ts.isVariableStatement(statement)) continue
    const name = declarationName(statement)
    if (!name) continue
    let end = statement.getEnd()
    const next = sourceFile.statements[index + 1]
    // 紧随其后的 IIFE 属于该枚举的挂载逻辑
    if (next && ts.isExpressionStatement(next) && next.expression.getText(sourceFile).includes(name)) {
      end = next.getEnd()
      index += 1
    }
    groups.set(name, source.slice(statement.getStart(sourceFile), end))
  }
  return groups
}

/**
 * 按归属把 JS 运行时枚举拆到各文件。
 * @param source 契约实现文件内容
 * @param owners 归属表
 * @param header 文件头注释
 * @return 文件名（不含 .js）→ 内容
 */
export function buildRuntimeFiles(source: string, owners: Map<string, string>, header: string) {
  const enums = parseRuntimeEnums(source)
  const groups = new Map<string, string[]>()
  for (const [name, code] of enums) {
    const owner = owners.get(name) ?? SHARED_BASE
    const list = groups.get(owner)
    if (list) list.push(code)
    else groups.set(owner, [code])
  }
  const files = new Map<string, string>()
  for (const [file, codes] of groups) files.set(file, [header, ...codes, ""].filter(Boolean).join("\n"))
  return files
}

/**
 * 读取指定扩展名的文本；不存在返回 null。
 * @param file 文件路径
 * @return 内容或 null
 */
function readText(file: string) {
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, "utf8")
}

/**
 * 无契约文档：补写空出口，保证聚合入口的 types 导出成立。
 * 出口与普通 barrel 同属本轮产物，按既有口径覆盖写入。
 * @param options 输出目录、输出形态与横幅语言
 * @return 写入结果
 */
function writeEmptyContractBarrel(options: { dir: string; toJS: boolean; language?: BannerLanguage }): ContractSplitResult {
  const header = generatedHeader(options.language ?? "zh").join("\n")
  const files = options.toJS ? ["index.js", "index.d.ts"] : ["index.ts"]
  const written: string[] = []
  for (const file of files) {
    const relative = `${TYPES_DIR}/${file}`
    fs.mkdirSync(path.dirname(path.join(options.dir, relative)), { recursive: true })
    fs.writeFileSync(path.join(options.dir, relative), `${header}\n\nexport {}\n`)
    written.push(relative)
  }
  return { written, errors: [] }
}

/**
 * 按业务文件拆分契约：生成 types/<业务文件> 与 types/shared，并把 types/index 改为 barrel。
 * 文档没有任何契约时补写空出口，不阻断生成。
 * @param options 输出目录、业务文件名、输出形态与横幅语言
 * @return 写入结果与错误
 */
export function splitContractOutput(options: { dir: string; moduleFiles: string[]; toJS: boolean; language?: BannerLanguage }): ContractSplitResult {
  const typesDir = path.join(options.dir, TYPES_DIR)
  const entryFile = options.toJS ? "index.d.ts" : "index.ts"
  const source = readText(path.join(typesDir, entryFile))
  if (!source) return writeEmptyContractBarrel(options)
  const contract = parseContractSource(source, `${TYPES_ENTRY}${path.extname(entryFile)}`)
  const modules = options.moduleFiles
    .map((file) => ({ file, source: readText(path.join(options.dir, `${file}${options.toJS ? ".d.ts" : ".ts"}`)) }))
    .filter((item): item is { file: string; source: string } => Boolean(item.source))
  const owners = planContractOwnership(contract.declarations, modules)
  const files = buildContractFiles(contract, owners, { toJS: options.toJS })
  if (options.toJS) {
    const runtime = readText(path.join(typesDir, "index.js"))
    if (runtime) for (const [file, content] of buildRuntimeFiles(runtime, owners, contract.header)) files.set(`${file}.js`, content)
  }
  const errors: string[] = []
  // 先整体校验手写冲突，避免部分落盘后才失败；barrel 由生成器提供，属本轮产物
  const barrelFiles = new Set(["index.ts", "index.js", "index.d.ts"])
  for (const file of files.keys()) {
    if (barrelFiles.has(file)) continue
    const relative = `${TYPES_DIR}/${file}`
    const target = path.join(options.dir, relative)
    // 生成物带横幅，可安全覆盖；不含横幅的同名文件视为手写，终止写入
    if (fs.existsSync(target) && !isGeneratedFile(target)) {
      errors.push(`输出目录存在同名手写文件：${relative}（不含生成横幅）`)
    }
  }
  if (errors.length > 0) return { written: [], errors }
  const written: string[] = []
  for (const [file, content] of files) {
    const relative = `${TYPES_DIR}/${file}`
    fs.mkdirSync(path.dirname(path.join(options.dir, relative)), { recursive: true })
    fs.writeFileSync(path.join(options.dir, relative), content)
    written.push(relative)
  }
  return { written, errors }
}
