import { describe, expect, it } from "vitest"
import { buildAggregateDeclarations, buildAggregateEntry, buildSplitFacade, buildSplitFacadeDeclarations } from "../utils/modular"

/** 模块列表：含与聚合类同名的模块，覆盖别名分支 */
const modules = [
  { base: "App", className: "App", property: "app" },
  { base: "Api", className: "Api", property: "api" }
]

describe("分组聚合入口", () => {
  it("导出 http-client，并注入聚合实例", () => {
    const code = buildAggregateEntry(modules, "Api", "", false)
    expect(code).toContain('export * from "./http-client"')
    expect(code).toContain('export * from "./data-contracts"')
    expect(code).toContain("app = new App(this)")
    expect(code).toContain("api = new ApiModule(this)")
    expect(code).toContain("export class Api<SecurityDataType = unknown> extends HttpClient<SecurityDataType>")
  })

  it("JS 声明同步导出 http-client，并声明组属性类型", () => {
    const code = buildAggregateDeclarations(modules, "Api")
    expect(code).toContain('export * from "./http-client"')
    expect(code).toContain('export * from "./data-contracts"')
    expect(code).toContain("app: App")
    expect(code).toContain("api: ApiModule")
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
