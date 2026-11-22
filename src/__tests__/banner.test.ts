import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { GENERATED_BANNER, GENERATED_BANNER_ZH, resolveBannerLanguage, rewriteGeneratedBanners } from "../utils/banner"

describe("横幅语言配置", () => {
  it("缺省中文", () => {
    expect(resolveBannerLanguage({})).toBe("zh")
    expect(resolveBannerLanguage(null)).toBe("zh")
    expect(resolveBannerLanguage({ output: {} })).toBe("zh")
  })

  it("按配置取中英文", () => {
    expect(resolveBannerLanguage({ output: { banner: "en" } })).toBe("en")
    expect(resolveBannerLanguage({ output: { banner: "zh" } })).toBe("zh")
  })

  it("非法值告警后回落中文", () => {
    const warnings: string[] = []
    expect(resolveBannerLanguage({ output: { banner: "fr" } }, (message) => warnings.push(message))).toBe("zh")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("output.banner")
  })
})

describe("产物横幅改写", () => {
  /** 用例创建的临时目录，结束后清理 */
  const roots: string[] = []

  afterEach(() => {
    while (roots.length) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
  })

  /**
   * 创建用例目录。
   * @return 目录绝对路径
   */
  const makeDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s2a-banner-"))
    roots.push(dir)
    return dir
  }

  /** 上游多行横幅 */
  const upstreamBlock = [
    "/*",
    " * ---------------------------------------------------------------",
    ` * ## ${GENERATED_BANNER}        ##`,
    " * ##                                                           ##",
    " * ## AUTHOR: acacode                                           ##",
    " * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##",
    " * ---------------------------------------------------------------",
    " */"
  ].join("\n")

  it("英文块改写为中文，工具单行横幅同样处理", () => {
    const dir = makeDir()
    fs.writeFileSync(path.join(dir, "Module.ts"), `${upstreamBlock}\nexport class Module {}\n`)
    fs.writeFileSync(path.join(dir, "index.ts"), `/* eslint-disable */\n/* tslint:disable */\n/* ## ${GENERATED_BANNER} ## */\nexport class Api {}\n`)
    fs.writeFileSync(path.join(dir, "handwritten.ts"), "export const value = 1\n")

    const changed = rewriteGeneratedBanners(dir, "zh")

    expect(changed.sort()).toEqual(["Module.ts", "index.ts"])
    for (const file of ["Module.ts", "index.ts"]) {
      const source = fs.readFileSync(path.join(dir, file), "utf8")
      expect(source).toContain(GENERATED_BANNER_ZH)
      expect(source).not.toContain(GENERATED_BANNER)
    }
    expect(fs.readFileSync(path.join(dir, "handwritten.ts"), "utf8")).toBe("export const value = 1\n")
  })

  it("中文块可切回英文，且不重复改写", () => {
    const dir = makeDir()
    fs.writeFileSync(path.join(dir, "Module.ts"), `${upstreamBlock}\nexport class Module {}\n`)

    rewriteGeneratedBanners(dir, "zh")
    expect(rewriteGeneratedBanners(dir, "zh")).toEqual([])

    const changed = rewriteGeneratedBanners(dir, "en")
    expect(changed).toEqual(["Module.ts"])
    const source = fs.readFileSync(path.join(dir, "Module.ts"), "utf8")
    expect(source).toContain(GENERATED_BANNER)
    expect(source).not.toContain(GENERATED_BANNER_ZH)
  })

  it("正文中的锚点不被改写", () => {
    const dir = makeDir()
    const body = `export const doc = "${GENERATED_BANNER}"\n`
    fs.writeFileSync(path.join(dir, "Module.ts"), `${upstreamBlock}\n${body}`)

    rewriteGeneratedBanners(dir, "zh")

    expect(fs.readFileSync(path.join(dir, "Module.ts"), "utf8")).toContain(body)
  })
})
