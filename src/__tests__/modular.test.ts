import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { buildAggregateDeclarations, buildAggregateEntry, buildSplitFacade, buildSplitFacadeDeclarations, collectGeneratedFiles } from "../utils/modular"

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
})

describe("生成清单收集", () => {
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
