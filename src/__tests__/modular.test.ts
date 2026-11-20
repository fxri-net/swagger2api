import { describe, expect, it } from "vitest"
import { buildAggregateDeclarations, buildAggregateEntry } from "../utils/modular"

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
})
