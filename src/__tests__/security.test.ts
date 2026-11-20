// 生成链安全加固：转义、标识符校验、外部引用策略
import { describe, expect, it } from "vitest"
import { escapeJsStringLiteral } from "../utils/security/escape-js-string-literal"
import { escapeJsTemplateLiteralStatic, escapeJsTemplateLiteralWithPathParams } from "../utils/security/escape-js-template-literal-with-path-params"
import { escapeSpecValues, guardSpec, resolveExternalRefs, validateSpecIdentifiers } from "../utils/security/spec-guard"

/** 公网地址解析桩 */
const publicResolver = async () => ["93.184.216.34"]
/** 私网地址解析桩 */
const privateResolver = async () => ["127.0.0.1"]

/**
 * 构造 JSON 响应桩
 * @param body 响应体
 * @return 响应对象
 */
function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe("代码字面量转义", () => {
  it("双引号字面量：普通值不变，特殊字符被转义", () => {
    expect(escapeJsStringLiteral("draft")).toBe("draft")
    expect(escapeJsStringLiteral('a"b')).toBe('a\\"b')
    expect(escapeJsStringLiteral("a\nb")).toBe("a\\nb")
  })

  it("模板字面量：反斜杠、反引号与 ${ 被转义", () => {
    expect(escapeJsTemplateLiteralStatic("/app/items")).toBe("/app/items")
    expect(escapeJsTemplateLiteralStatic("/a`b${c}")).toBe("/a\\`b\\${c}")
  })

  it("模板字面量：保留已声明的路径参数插值", () => {
    expect(escapeJsTemplateLiteralWithPathParams("/a/${id}/`x`", ["id"])).toBe("/a/${id}/\\`x\\`")
  })
})

describe("spec 字面量转义与标识符校验", () => {
  it("路径、枚举值、默认值与 servers 地址被转义", () => {
    const spec: any = {
      paths: { "/a`b": { get: {} } },
      servers: [{ url: 'https://x"y' }],
      components: { schemas: { S: { type: "string", enum: ['a"b'], default: 'c"d' } } }
    }
    escapeSpecValues(spec)
    expect(Object.keys(spec.paths)).toEqual(["/a\\`b"])
    expect(spec.servers[0].url).toBe('https://x\\"y')
    expect(spec.components.schemas.S.enum).toEqual(['a\\"b'])
    expect(spec.components.schemas.S.default).toBe('c\\"d')
  })

  it("属性名含越界字符时报错", () => {
    const spec: any = { components: { schemas: { S: { type: "object", properties: { 'a"b': { type: "string" } } } } } }
    expect(validateSpecIdentifiers(spec)).toHaveLength(1)
  })

  it("正常文档无错误", () => {
    const spec: any = { paths: { "/app/items": { get: {} } }, components: { schemas: { S: { type: "object", required: ["id"] } } } }
    expect(validateSpecIdentifiers(spec)).toEqual([])
  })
})

describe("外部引用闸门", () => {
  it("非 http(s) 的外部引用被拒绝", async () => {
    const spec: any = { paths: { "/a": { get: { responses: { "200": { $ref: "./other.json#/x" } } } } } }
    const errors = await resolveExternalRefs(spec, { baseUrl: "https://example.com/spec.json" })
    expect(errors[0]).toContain("不支持的外部引用")
  })

  it("私网地址被拒绝", async () => {
    const spec: any = { paths: { "/a": { get: { responses: { "200": { $ref: "http://127.0.0.1/schema.json#/components/schemas/X" } } } } } }
    const errors = await resolveExternalRefs(spec, { baseUrl: "https://example.com/spec.json", resolve: privateResolver })
    expect(errors[0]).toContain("拒绝拉取")
  })

  it("公网地址被放行并按组件名注册", async () => {
    const spec: any = { components: { schemas: {} }, paths: { "/a": { get: { responses: { "200": { $ref: "https://cdn.example.com/common.json#/components/schemas/Common" } } } } } }
    const fetchImpl = async () => jsonResponse({ components: { schemas: { Common: { type: "object", properties: { id: { type: "string" } } } } } })
    const errors = await resolveExternalRefs(spec, { baseUrl: "https://example.com/spec.json", resolve: publicResolver, fetchImpl })
    expect(errors).toEqual([])
    expect(spec.paths["/a"].get.responses["200"].$ref).toBe("#/components/schemas/Common")
    expect(spec.components.schemas.Common.type).toBe("object")
  })

  it("重定向到私网被拒绝", async () => {
    const spec: any = { paths: { "/a": { get: { responses: { "200": { $ref: "https://cdn.example.com/common.json#/x" } } } } } }
    const fetchImpl = async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret.json" } })
    const errors = await resolveExternalRefs(spec, { baseUrl: "https://example.com/spec.json", resolve: publicResolver, fetchImpl })
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe("守卫入口", () => {
  it("正常文档无错误且保持内容", async () => {
    const spec: any = { paths: { "/app/items": { get: { responses: { "200": { description: "ok" } } } } }, components: { schemas: {} } }
    const result = await guardSpec(spec)
    expect(result.errors).toEqual([])
    expect(Object.keys(spec.paths)).toEqual(["/app/items"])
  })
})
