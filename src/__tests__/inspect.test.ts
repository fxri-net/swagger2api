// 产物布局审计：模块体量、分片门面识别、固定产物与阈值覆写
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_INSPECT_THRESHOLDS, formatInspectReport, inspectLayout, inspectThresholdsOf } from "../utils/inspect"

/** 用例创建的临时目录，结束后清理 */
const roots: string[] = []

/**
 * 创建临时目录结构
 * @param files 相对路径与内容
 * @return 临时根目录
 */
function makeTree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s2a-inspect-"))
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

/** 固定产物：聚合入口、客户端与契约目录 */
const FIXED = {
  "index.js": "export class Api {}",
  "client.js": "export class HttpClient {}",
  "types/index.d.ts": "export type A = string"
}

describe("产物布局审计", () => {
  it("识别小组独立成文件、分片门面与分片余量", () => {
    const root = makeTree({
      ...FIXED,
      "DgAdmin.js": "export class DgAdmin {\n  a = (params = {}) => this.http.request({ path: `/a` })\n}",
      "Options.js": "export class Options {\n  getPost = (params = {}) => this.http.request({ path: `/options/get` })\n}",
      "DgAdminPart1.js": "export class DgAdminPart1 {\n  a = (params = {}) => this.http.request({ path: `/p1` })\n}",
      "DgAdminFacade.js": [
        "export class DgAdminFacade {",
        "  constructor(http) {",
        "    this.http = http",
        "    Object.assign(this, new DgAdminPart1(http))",
        "  }",
        "}"
      ].join("\n")
    })
    const report = inspectLayout(root)
    expect(report.mode).toBe("grouped")
    expect(report.total).toBe(3)
    expect(report.issues.some((issue) => issue.includes("Options.js"))).toBe(true)
    expect(report.issues.some((issue) => issue.includes("Part1"))).toBe(false)
    expect(report.hints.some((hint) => hint.includes("分片余量偏小"))).toBe(true)
    expect(report.modules.find((item) => item.file === "DgAdminFacade.js")?.facade).toBe(true)
  })

  it("识别 TS 泛型请求形态并统计体量", () => {
    const root = makeTree({
      "index.ts": "export class Api {}",
      "client.ts": "export class HttpClient {}",
      "types/index.ts": "export type A = string",
      "Modules.ts": "export class A {\n  a = (params: RequestParams = {}) => this.http.request<Foo>({ path: `/a` })\n}"
    })
    const report = inspectLayout(root)
    expect(report.modules[0].routes).toBe(1)
    expect(report.issues.some((issue) => issue.includes("Modules.ts"))).toBe(true)
  })

  it("split 为 false 时跳过布局判据，只保留固定产物检查", () => {
    const root = makeTree({
      ...FIXED,
      "Options.js": "export class Options {\n  getPost = (params = {}) => this.http.request({ path: `/options/get` })\n}"
    })
    const report = inspectLayout(root, inspectThresholdsOf(false))
    expect(report.issues).toEqual([])
  })

  it("缺少固定产物时报异常", () => {
    const root = makeTree({
      "DgAdmin.js": "export class DgAdmin {}"
    })
    const report = inspectLayout(root)
    expect(report.mode).toBe("single")
    const grouped = makeTree({
      "client.js": "export class HttpClient {}",
      "DgAdmin.js": "export class DgAdmin {}"
    })
    const groupedReport = inspectLayout(grouped)
    expect(groupedReport.issues).toEqual(expect.arrayContaining([expect.stringContaining("index.ts / index.js"), expect.stringContaining("types/")]))
  })

  it("阈值覆写按默认值补齐缺省项", () => {
    expect(inspectThresholdsOf({ minBucketRoutes: 2 })).toEqual({ ...DEFAULT_INSPECT_THRESHOLDS, minBucketRoutes: 2 })
    expect(inspectThresholdsOf({ maxRoutes: 0 })).toEqual({ ...DEFAULT_INSPECT_THRESHOLDS })
  })

  it("文本报告包含体量与问题清单", () => {
    const root = makeTree({
      ...FIXED,
      "Options.js": "export class Options {\n  getPost = (params = {}) => this.http.request({ path: `/options/get` })\n}"
    })
    const lines = formatInspectReport(inspectLayout(root))
    expect(lines[0]).toContain("产物布局审计")
    expect(lines.join("\n")).toContain("问题：")
  })
})
