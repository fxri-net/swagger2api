// URL 判定：只有 http(s) 与协议相对地址算 URL，普通路径与空值不算
import { describe, expect, it } from "vitest"
import { isUrl } from "../utils/method"

describe("isUrl", () => {
  it("识别 http / https 地址", () => {
    expect(isUrl("http://example.com/a")).toBe(true)
    expect(isUrl("https://example.com")).toBe(true)
  })

  it("识别协议相对地址", () => {
    expect(isUrl("//example.com/a")).toBe(true)
  })

  it("普通路径、裸域名与空值都不算 URL", () => {
    expect(isUrl("./docs/index.md")).toBe(false)
    expect(isUrl("example.com")).toBe(false)
    expect(isUrl("")).toBe(false)
  })
})
