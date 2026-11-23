// 配置写盘：默认值剔除与单行压缩
import { describe, expect, it } from "vitest"
import { stringifyConfig, stripDefaults } from "../utils/config-format"

describe("配置默认值剔除", () => {
  it("剔除等于默认值的字段", () => {
    const config = {
      base: {
        client: "fetch",
        language: "ts",
        types: { responses: true },
        naming: { pathPrefixIndex: 0 },
        output: { name: "index", mode: "single", typeCheck: "skip", banner: "zh" },
        input: { timeout: 0 }
      },
      docs: [{ id: "main", source: "https://example.com/a.json", output: { dir: "./src/api", name: "index" } }]
    }
    const result = stripDefaults(config)
    expect(result.base).toEqual({ types: { responses: true }, naming: { pathPrefixIndex: 0 } })
    expect(result.docs[0].output).toEqual({ dir: "./src/api" })
  })

  it("保留非默认值与看似默认的个性化项", () => {
    const config = {
      base: {
        client: "axios",
        language: "js",
        types: { responses: true, extractQuery: "arg0" },
        naming: { pathPrefixIndex: 0, convertGetToQuery: true },
        output: { mode: "grouped", typeCheck: "enforce", name: "sdk" }
      },
      docs: [{ id: "main", source: "https://example.com/a.json", output: "./src/api" }]
    }
    expect(stripDefaults(config)).toEqual(config)
  })

  it("不改动入参", () => {
    const config = { base: { client: "fetch" } }
    stripDefaults(config)
    expect(config.base.client).toBe("fetch")
  })
})

describe("配置单行压缩", () => {
  it("短文档项保持单行", () => {
    const text = stringifyConfig({
      base: { client: "axios", output: { mode: "grouped" } },
      docs: [{ id: "base", output: "./src/api/base", source: { url: "https://example.com/a.json" } }]
    })
    expect(text).toContain(`{ "id": "base", "output": "./src/api/base", "source": { "url": "https://example.com/a.json" } }`)
    expect(text.endsWith("\n")).toBe(true)
  })

  it("超长对象逐层展开", () => {
    const longUrl = `https://example.com/${"a".repeat(200)}.json`
    const text = stringifyConfig({ docs: [{ id: "base", output: "./src/api/base", source: { url: longUrl } }] })
    expect(text).toContain('"id": "base"')
    expect(text).toContain(`"url": "${longUrl}"`)
    expect(text.split("\n").length).toBeGreaterThan(5)
  })

  it("二次写盘零差异", () => {
    const config = {
      base: { client: "axios", types: { responses: true }, output: { mode: "grouped" } },
      docs: [
        { id: "base", output: "./src/api/base", source: "https://example.com/a.json" },
        { id: "tim", output: { dir: "./src/api/tim", clean: true }, source: "https://example.com/b.json" }
      ]
    }
    const once = stringifyConfig(stripDefaults(config))
    expect(stringifyConfig(stripDefaults(JSON.parse(once)))).toBe(once)
  })
})
