// 接口面基线：从生成产物提取请求与导出类型，并按基线比对增删
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { SURFACE_FORMAT_VERSION, collectSurface, compareSurface, type SurfacePayload } from "../utils/surface"

/** 用例创建的临时目录，结束后清理 */
const roots: string[] = []

/**
 * 创建临时目录结构
 * @param files 相对路径与内容
 * @return 临时根目录
 */
function makeTree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s2a-surface-"))
  roots.push(root)
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
})

/** 单目标基线 */
function single(requests: Array<{ request: string; name: string }>, types: string[]): SurfacePayload {
  return { formatVersion: SURFACE_FORMAT_VERSION, requests, types }
}

describe("接口面提取", () => {
  it("提取 TS / 声明文件中的请求与导出类型并排序去重", () => {
    const root = makeTree({
      "Modules.ts": [
        "export interface AppItem {",
        "  id: string",
        "}",
        "/**",
        " * @name ItemsGet",
        " * @request GET:/app/items",
        " */",
        "export type QueryParams = Record<string, unknown>",
        "/**",
        " * @name DetailPost",
        " * @request POST:/home/detail",
        " */"
      ].join("\n"),
      "types/index.d.ts": ["export interface Shared {", "}", "export interface AppItem {", "}"].join("\n"),
      "notes.md": "@name Ignored\n@request GET:/ignored\n"
    })
    const surface = collectSurface(root)
    expect(surface.requests).toEqual([
      { request: "GET:/app/items", name: "ItemsGet" },
      { request: "POST:/home/detail", name: "DetailPost" }
    ])
    expect(surface.types).toEqual(["AppItem", "QueryParams", "Shared"])
  })

  it("JS 产物同样提取，--requests-only 不收集类型", () => {
    const root = makeTree({
      "index.js": ["/**", " * @name ItemsGet", " * @request GET:/app/items", " */", "export const a = 1"].join("\n"),
      "index.d.ts": "export interface AppItem {}\n"
    })
    expect(collectSurface(root).types).toEqual(["AppItem"])
    const requestsOnly = collectSurface(root, { requestsOnly: true })
    expect(requestsOnly.requests).toEqual([{ request: "GET:/app/items", name: "ItemsGet" }])
    expect(requestsOnly.types).toEqual([])
  })
})

describe("基线比对", () => {
  const baseline = single(
    [
      { request: "GET:/app/items", name: "ItemsGet" },
      { request: "POST:/home/detail", name: "DetailPost" }
    ],
    ["AppItem", "HomeReq"]
  )

  it("一致时无差异", () => {
    expect(compareSurface(baseline, baseline)).toEqual({ lines: [], errors: [] })
  })

  it("新增与缺失分别标出接口和类型", () => {
    const current = single(
      [{ request: "GET:/app/items", name: "ItemsGet" }, { request: "GET:/app/list", name: "ListGet" }],
      ["AppItem", "ListResp"]
    )
    const diff = compareSurface(current, baseline)
    expect(diff.errors).toEqual([])
    expect(diff.lines).toEqual([
      "+ 接口 GET:/app/list（ListGet）",
      "- 接口 POST:/home/detail（DetailPost）",
      "+ 类型 ListResp",
      "- 类型 HomeReq"
    ])
  })

  it("--requests-only 忽略方法名与类型变化", () => {
    const current = single([{ request: "GET:/app/items", name: "ItemsGetRenamed" }, { request: "POST:/home/detail", name: "DetailPost" }], [])
    expect(compareSurface(current, baseline, { requestsOnly: true })).toEqual({ lines: [], errors: [] })
  })

  it("多目标按 id 分组，目标集合变化计入结构错误", () => {
    const current: SurfacePayload = {
      formatVersion: SURFACE_FORMAT_VERSION,
      targets: { base: { requests: [], types: [] } }
    }
    const previous: SurfacePayload = {
      formatVersion: SURFACE_FORMAT_VERSION,
      targets: { base: { requests: [], types: [] }, lc: { requests: [], types: [] } }
    }
    expect(compareSurface(current, previous).errors).toEqual(["缺失目标：lc"])
    expect(compareSurface(current, single([], [])).errors).toEqual(["目标结构不一致：一侧按 targets 分组，另一侧为单目标"])
  })

  it("格式版本不一致时拒绝比较", () => {
    const outdated: SurfacePayload = { ...baseline, formatVersion: SURFACE_FORMAT_VERSION - 1 }
    expect(compareSurface(baseline, outdated).errors[0]).toContain("基线格式版本不一致")
  })
})
