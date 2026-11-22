import { describe, expect, it } from "vitest"
import { normalizeSpecShape } from "../utils/spec-shape"

/** 合法的最小文档 */
const valid = () => ({
  openapi: "3.0.1",
  info: { title: "t", version: "1" },
  paths: { "/a/list": { get: { responses: { "200": { description: "ok" } } } } }
})

describe("文档形态归一", () => {
  it("根节点非对象直接拒绝", () => {
    for (const input of [null, undefined, [], "spec", 1]) {
      const result = normalizeSpecShape(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("E_SPEC_INVALID")
    }
  })

  it("Swagger 2.0 给出可读结论", () => {
    const result = normalizeSpecShape({ swagger: "2.0", paths: { "/a": {} }, definitions: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("E_SPEC_INVALID")
      expect(result.error.message).toContain("OpenAPI 3")
    }
  })

  it("paths 缺失或类型不正确时拒绝", () => {
    for (const paths of [undefined, null, [], "x"]) {
      const result = normalizeSpecShape({ paths })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("E_SPEC_INVALID")
    }
  })

  it("空 paths 与全部非法路径项按「没有接口」处理", () => {
    for (const paths of [{}, { "/a": null }, { "/a": "x" }]) {
      const result = normalizeSpecShape({ paths })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe("E_NO_ENDPOINTS")
    }
  })

  it("非法路径项被跳过并告警，其余接口保留", () => {
    const spec = valid()
    spec.paths["/bad"] = null
    const result = normalizeSpecShape(spec)
    expect(result.ok).toBe(true)
    expect(result.warnings.some((item) => item.includes("/bad"))).toBe(true)
    if (result.ok) expect(Object.keys(result.data.paths)).toEqual(["/a/list"])
  })

  it("components 缺失或为 null 时归一为空对象", () => {
    for (const components of [undefined, null]) {
      const spec = valid() as Record<string, any>
      if (components === null) spec.components = null
      const result = normalizeSpecShape(spec)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.components).toEqual({})
    }
  })

  it("components 非对象时拒绝", () => {
    const result = normalizeSpecShape({ ...valid(), components: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe("E_SPEC_INVALID")
  })

  it("空组件被跳过，布尔 schema 保留", () => {
    const result = normalizeSpecShape({ ...valid(), components: { schemas: { A: null, B: true } } })
    expect(result.ok).toBe(true)
    expect(result.warnings.some((item) => item.includes("components.schemas.A"))).toBe(true)
    if (result.ok) expect(result.data.components.schemas).toEqual({ B: true })
  })

  it("合法文档原样返回", () => {
    const spec = valid()
    const result = normalizeSpecShape(spec)
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    if (result.ok) expect(result.data.paths).toEqual(spec.paths)
  })
})
