import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  GENERATED_BANNER,
  GENERATED_BANNER_ZH,
  buildAggregateDeclarations,
  buildAggregateEntry,
  buildSplitFacade,
  buildSplitFacadeDeclarations,
  buildSplitFacadeJs,
  collectGeneratedFiles,
  findHandwrittenConflicts,
  findStaleOutputFiles,
  isGeneratedFile,
  pruneGeneratedOutput
} from "../utils/modular"

/** 模块列表：含与聚合类同名的模块，覆盖别名分支 */
const modules = [
  { base: "App", className: "App", property: "app" },
  { base: "Api", className: "Api", property: "api" }
]

describe("分组聚合入口", () => {
  it("导出 client 与 types，并注入聚合实例", () => {
    const code = buildAggregateEntry(modules, "Api", "", false)
    expect(code).toContain('export * from "./client"')
    expect(code).toContain('export * from "./types"')
    expect(code).toContain("app = new App(this)")
    expect(code).toContain("api = new ApiModule(this)")
    expect(code).toContain("export class Api<SecurityDataType = unknown> extends HttpClient<SecurityDataType>")
  })

  it("JS 声明同步导出 client 与 types，并声明组属性类型", () => {
    const code = buildAggregateDeclarations(modules, "Api")
    expect(code).toContain('export * from "./client"')
    expect(code).toContain('export * from "./types"')
    expect(code).toContain("app: App")
    expect(code).toContain("api: ApiModule")
  })

  it("JS 实现不输出 TypeScript 语法", () => {
    const code = buildAggregateEntry(modules, "Api", "", true)
    expect(code).not.toContain("<SecurityDataType")
    expect(code).not.toContain("config?: any")
    expect(code).toContain("export class Api extends HttpClient {")
  })

  it("同源模块合并导入，分片门面单独导入", () => {
    const splitModules = [
      { base: "App", className: "App", property: "app", importFrom: "App" },
      { base: "Misc", className: "Misc", property: "misc", importFrom: "App" },
      { base: "DgAdmin", className: "DgAdmin", property: "dgAdmin", importFrom: "DgAdmin" }
    ]
    const code = buildAggregateEntry(splitModules, "Api", "", false)
    expect(code).toContain('import { App, Misc } from "./App"')
    expect(code).toContain('import { DgAdmin } from "./DgAdmin"')
    expect(code).toContain("dgAdmin = new DgAdmin(this)")
    const declarations = buildAggregateDeclarations(splitModules, "Api")
    expect(declarations).toContain('import { App, Misc } from "./App"')
  })

  it("本工具自写产物同样带生成横幅，整目录可被同源识别", () => {
    expect(buildAggregateEntry(modules, "Api", "", false)).toContain(GENERATED_BANNER_ZH)
    expect(buildAggregateDeclarations(modules, "Api")).toContain(GENERATED_BANNER_ZH)
    const facade = { fileName: "DgAdmin", className: "DgAdmin", title: "dg_admin", chunks: [{ fileName: "DgAdminPart1", className: "DgAdminPart1" }] }
    expect(buildSplitFacade(facade)).toContain(GENERATED_BANNER_ZH)
    expect(buildSplitFacadeDeclarations(facade)).toContain(GENERATED_BANNER_ZH)
  })

  it("横幅语言可切换为英文", () => {
    expect(buildAggregateEntry(modules, "Api", "", false, "en")).toContain(GENERATED_BANNER)
    const facade = { fileName: "DgAdmin", className: "DgAdmin", title: "dg_admin", chunks: [{ fileName: "DgAdminPart1", className: "DgAdminPart1" }] }
    expect(buildSplitFacade(facade, "en")).toContain(GENERATED_BANNER)
    expect(buildSplitFacadeDeclarations(facade, "en")).toContain(GENERATED_BANNER)
  })

  it("模块共享请求器不可枚举，避免深合并沿聚合入口成环", () => {
    const facade = { fileName: "DgAdmin", className: "DgAdmin", title: "dg_admin", chunks: [{ fileName: "DgAdminPart1", className: "DgAdminPart1" }] }
    for (const code of [buildSplitFacade(facade), buildSplitFacadeJs(facade)]) {
      expect(code).toContain('Object.defineProperty(this, "http", { value: http, enumerable: false })')
      expect(code).not.toContain("this.http = http")
    }
  })
})

describe("产物归属与清理", () => {
  /** 用例创建的临时目录，结束后清理 */
  const roots: string[] = []

  afterEach(() => {
    while (roots.length) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
  })

  /**
   * 创建用例目录
   * @return 目录绝对路径
   */
  const makeDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s2a-output-"))
    roots.push(dir)
    return dir
  }

  /**
   * 写入文件（自动建目录）
   * @param dir 目录
   * @param file 相对路径
   * @param content 内容
   * @return 无
   */
  const write = (dir: string, file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }

  /** 生成物内容 */
  const generated = `/* ## ${GENERATED_BANNER} ## */\nexport class App {}\n`

  it("按文件头横幅判定归属，手写文件不算生成物", () => {
    const dir = makeDir()
    write(dir, "App.ts", generated)
    write(dir, "hand.ts", "// 手写适配\n")
    expect(isGeneratedFile(path.join(dir, "App.ts"))).toBe(true)
    expect(isGeneratedFile(path.join(dir, "hand.ts"))).toBe(false)
  })

  it("横幅只在文件头 1KB 内生效，正文提及不算生成物", () => {
    const dir = makeDir()
    write(dir, "hand.ts", `${"// 填充内容，确保横幅落在 1KB 之后\n".repeat(80)}/* ${GENERATED_BANNER} */\n`)
    expect(isGeneratedFile(path.join(dir, "hand.ts"))).toBe(false)
  })

  it("递归找出不在 keep 集合内的生成物，保留手写文件与 keep 内文件", () => {
    const dir = makeDir()
    write(dir, "index.ts", generated)
    write(dir, "types/index.ts", generated)
    write(dir, "types/Old.ts", generated)
    write(dir, "types/hand.ts", "// 手写契约\n")
    expect(findStaleOutputFiles(dir, ["index.ts", "types/index.ts"])).toEqual(["types/Old.ts"])
    expect(pruneGeneratedOutput(dir, ["index.ts", "types/index.ts"])).toEqual(["types/Old.ts"])
    expect(fs.existsSync(path.join(dir, "types/Old.ts"))).toBe(false)
    expect(fs.existsSync(path.join(dir, "types/hand.ts"))).toBe(true)
    expect(fs.existsSync(path.join(dir, "types/index.ts"))).toBe(true)
  })

  it("手写文件护栏：不含横幅的同名文件视为冲突", () => {
    const dir = makeDir()
    const entries = [{ raw: "app", key: "app", fileName: "App", className: "App", property: "app", reason: "", source: "auto" as const }]
    write(dir, "App.ts", "// 手写模块\n")
    expect(findHandwrittenConflicts(dir, entries, false)).toEqual(["App.ts"])
    write(dir, "App.ts", generated)
    expect(findHandwrittenConflicts(dir, entries, false)).toEqual([])
  })

  it("旧版聚合入口与门面不带横幅也识别为生成物", () => {
    const dir = makeDir()
    const head = "/* eslint-disable */\n/* tslint:disable */\n"
    write(
      dir,
      "index.ts",
      `${head}import { HttpClient } from "./client"\nexport * from "./types"\nexport * from "./client"\n/** 聚合入口：各模块共享同一个请求实例 */\nexport class Api extends HttpClient {}\n`,
    )
    write(
      dir,
      "DgAdmin.js",
      `${head}import { DgAdminPart1 } from "./DgAdminPart1"\n/** dg_admin 模块：由分片合并，对外与单文件产物一致 */\nexport class DgAdmin {\n  constructor(http) {\n    Object.assign(this, new DgAdminPart1(http))\n  }\n}\n`,
    )
    write(
      dir,
      "DgAdmin.d.ts",
      `${head}import { DgAdminPart1 } from "./DgAdminPart1"\nexport interface DgAdmin<SecurityDataType = unknown> extends DgAdminPart1<SecurityDataType> {}\nexport declare class DgAdmin<SecurityDataType = unknown> {}\n`,
    )
    for (const file of ["index.ts", "DgAdmin.js", "DgAdmin.d.ts"]) {
      expect(isGeneratedFile(path.join(dir, file))).toBe(true)
    }
  })

  it("只有固定头但无旧版特征的手写文件不算生成物", () => {
    const dir = makeDir()
    write(dir, "hand.ts", "/* eslint-disable */\n/* tslint:disable */\n// 手写扩展\nexport const custom = 1\n")
    expect(isGeneratedFile(path.join(dir, "hand.ts"))).toBe(false)
  })
})

describe("本轮产物收集", () => {
  /** 用例创建的临时目录，结束后清理 */
  const roots: string[] = []

  afterEach(() => {
    while (roots.length) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
  })

  it("只收录本轮命名可推导的产物，不把残留契约当成本轮产物", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s2a-manifest-"))
    roots.push(dir)
    const write = (file: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.writeFileSync(path.join(dir, file), "")
    }
    for (const file of [
      "index.js",
      "index.d.ts",
      "client.js",
      "client.d.ts",
      "DgAdmin.js",
      "DgAdmin.d.ts",
      "types/index.js",
      "types/index.d.ts",
      "types/DgAdmin.d.ts",
      "types/shared.d.ts",
      // 上一轮遗留：组已删除、分片已回填后残留
      "types/Options.d.ts",
      "types/DgAdminPart7.d.ts"
    ]) {
      write(file)
    }
    const files = collectGeneratedFiles(dir, [{ raw: "dg_admin", key: "dgadmin", fileName: "DgAdmin", className: "DgAdmin", property: "dgAdmin", reason: "", source: "auto" }], true)
    expect(files).toEqual(expect.arrayContaining(["types/index.d.ts", "types/DgAdmin.d.ts", "types/shared.d.ts"]))
    expect(files).not.toContain("types/Options.d.ts")
    expect(files).not.toContain("types/DgAdminPart7.d.ts")
  })
})

describe("分片门面", () => {
  const facade = {
    fileName: "DgAdmin",
    className: "DgAdmin",
    title: "dg_admin",
    chunks: [
      { fileName: "DgAdminPart1", className: "DgAdminPart1" },
      { fileName: "DgAdminPart2", className: "DgAdminPart2" }
    ]
  }

  it("运行期合并分片实例并共享请求器", () => {
    const code = buildSplitFacade(facade)
    expect(code).toContain('import { DgAdminPart1 } from "./DgAdminPart1"')
    expect(code).toContain("Object.assign(this, new DgAdminPart1(http), new DgAdminPart2(http))")
    expect(code).toContain("get instance(): HttpClient<SecurityDataType>[\"instance\"]")
  })

  it("类型合并保持同一命名空间", () => {
    const code = buildSplitFacade(facade)
    expect(code).toContain("export interface DgAdmin<SecurityDataType = unknown> extends DgAdminPart1<SecurityDataType>, DgAdminPart2<SecurityDataType> {}")
    const declarations = buildSplitFacadeDeclarations(facade)
    expect(declarations).toContain("export interface DgAdmin<SecurityDataType = unknown> extends DgAdminPart1<SecurityDataType>, DgAdminPart2<SecurityDataType> {}")
    expect(declarations).toContain("export declare class DgAdmin<SecurityDataType = unknown>")
  })
})
