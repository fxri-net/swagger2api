// 配置分层与归一：三层合并、环境变量覆盖、预设、单文档归一与脚本参数迁移
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  applyEnvOverrides,
  applyProfileToBase,
  deepMergeConfig,
  findUpward,
  getByPath,
  loadConfigLayers,
  mergeShallow,
  normalizeDocConfig,
  setByPath
} from "../utils/config"
import { argsToConfig, migrateFromPackage, tokenizeArgs } from "../utils/migrate"

/** 用例创建的临时目录，结束后清理 */
const roots: string[] = []

/**
 * 创建临时目录结构
 * @param files 相对路径与内容
 * @return 临时根目录
 */
function makeTree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s2a-config-"))
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

describe("配置合并", () => {
  it("段内浅合并：数组整体替换", () => {
    expect(
      mergeShallow({ naming: { tagRewrite: ["a", "b"], convertGetToQuery: false } }, { naming: { tagRewrite: ["c", "d"] } })
    ).toEqual({ naming: { tagRewrite: ["c", "d"], convertGetToQuery: false } })
  })

  it("深度合并对象、整体替换数组", () => {
    expect(
      deepMergeConfig({ output: { name: "index", mode: "single" }, naming: { tagRewrite: ["a", "b"] } }, { output: { name: "api" }, naming: { tagRewrite: ["c", "d"] } })
    ).toEqual({ output: { name: "api", mode: "single" }, naming: { tagRewrite: ["c", "d"] } })
  })

  it("点号路径读写", () => {
    const target: Record<string, any> = {}
    setByPath(target, "output.mode", "grouped")
    expect(getByPath(target, "output.mode")).toBe("grouped")
    expect(getByPath(target, "missing.key")).toBeUndefined()
  })
})

describe("环境变量与预设", () => {
  it("FX_S2A_* 覆盖对应键", () => {
    const result = applyEnvOverrides({ input: { url: "a" } }, { FX_S2A_OUTPUT: "./out", FX_S2A_CLEAN: "false" })
    expect(result.output.dir).toBe("./out")
    expect(result.output.clean).toBe(false)
  })

  it("预设深度合并进 base", () => {
    const result = applyProfileToBase({ output: { name: "index", mode: "single" } }, { admin: { output: { name: "admin" }, client: "axios" } }, "admin")
    expect(result).toEqual({ output: { name: "admin", mode: "single" }, client: "axios" })
  })
})

describe("三层加载", () => {
  it("base 深度合并，docs 按 id 覆盖或追加", () => {
    const root = makeTree({
      ".swagger2api.json": JSON.stringify({ base: { types: { responses: true } } }),
      "swagger2api.json": JSON.stringify({
        base: { output: { name: "index", mode: "grouped" }, client: "axios" },
        docs: [{ id: "a", source: "https://example.com/a.json", output: "./api/a" }],
        profiles: { admin: { output: { name: "admin" } } }
      }),
      "swagger2api.local.json": JSON.stringify({
        docs: [
          { id: "b", source: "./b.json", output: "./api/b" },
          { id: "a", output: "./api/local-a" }
        ]
      }),
      "apps/admin/.keep": ""
    })
    const layers = loadConfigLayers(path.join(root, "apps", "admin"), { homeDir: root })
    expect(layers.project.file).toBe(path.join(root, "swagger2api.json"))
    expect(layers.local.file).toBe(path.join(root, "swagger2api.local.json"))
    expect(layers.merged?.base).toEqual({ output: { name: "index", mode: "grouped" }, client: "axios", types: { responses: true } })
    expect(layers.merged?.docs).toEqual([
      { id: "a", source: "https://example.com/a.json", output: "./api/local-a" },
      { id: "b", source: "./b.json", output: "./api/b" }
    ])
  })

  it("旧字段作为根键时报错", () => {
    const root = makeTree({ "swagger2api.json": JSON.stringify({ input: { url: "old" }, output: { dir: "./api" } }) })
    const layers = loadConfigLayers(root, { homeDir: path.join(root, "home") })
    expect(layers.errors.some((error) => error.includes("不支持的根字段 input"))).toBe(true)
    expect(layers.errors.some((error) => error.includes("不支持的根字段 output"))).toBe(true)
  })

  it("全局层不允许声明 docs", () => {
    const root = makeTree({
      ".swagger2api.json": JSON.stringify({ docs: [{ id: "a" }] }),
      "swagger2api.json": JSON.stringify({ docs: [] }),
      "apps/.keep": ""
    })
    const layers = loadConfigLayers(path.join(root, "apps"), { homeDir: root })
    expect(layers.errors.some((error) => error.includes("全局层不允许声明 docs"))).toBe(true)
  })

  it("解析失败的层被忽略并告警", () => {
    const root = makeTree({ "swagger2api.json": "{ bad json" })
    const layers = loadConfigLayers(root, { homeDir: path.join(root, "home") })
    expect(layers.project.hit).toBe(false)
    expect(layers.warnings.length).toBe(1)
  })

  it("findUpward 从子目录命中父级文件", () => {
    const root = makeTree({ "swagger2api.json": "{}", "a/b/c/.keep": "" })
    expect(findUpward("swagger2api.json", path.join(root, "a", "b", "c"))).toBe(path.join(root, "swagger2api.json"))
  })
})

describe("单文档归一", () => {
  it("source 字符串转为输入，字符串简写转为对象", () => {
    const config = normalizeDocConfig({
      source: "https://example.com/api-docs",
      output: { name: "index", mode: "grouped" },
      client: "axios",
      language: "js",
      types: { responses: true },
      naming: { pathPrefixIndex: 0 }
    })
    expect(config.input.url).toBe("https://example.com/api-docs")
    expect(config.output).toMatchObject({ name: "index", mode: "grouped", prune: true })
    expect(config.client).toEqual({ type: "axios" })
    expect(config.language).toEqual({ target: "js" })
    // 分组模式未显式配置时给路径分组与分桶默认值
    expect(config.grouping).toEqual({ strategy: ["path"], pathDepth: 0, split: true })
    expect(config.source).toBeUndefined()
  })

  it("显式分组配置原样生效，不追加 split 默认值", () => {
    const config = normalizeDocConfig({
      source: "./swagger.json",
      output: { dir: "./api", mode: "grouped" },
      grouping: { strategy: ["tag"], names: { a: "b" } }
    })
    expect(config.grouping).toEqual({ strategy: ["tag"], names: { a: "b" } })
  })

  it("source 对象保留 headers 与 timeout", () => {
    const config = normalizeDocConfig({ source: { file: "./swagger.json", headers: { a: "b" }, timeout: 500 }, output: "./api" })
    expect(config.input.file).toBe("./swagger.json")
    expect(config.input.headers).toEqual({ a: "b" })
    expect(config.input.timeout).toBe(500)
    expect(config.output).toMatchObject({ dir: "./api", name: "index" })
  })

  it("base.output.name 作为入口文件名默认值", () => {
    const config = normalizeDocConfig({ source: "./swagger.json", output: { dir: "./api", name: "api" } })
    expect(config.output.name).toBe("api")
  })
})

describe("脚本迁移", () => {
  it("切分引号与正则参数", () => {
    expect(tokenizeArgs(`--config swagger2api.json --quick --rt "[a-z_]+(.+)" "$1"`)).toEqual([
      "--config",
      "swagger2api.json",
      "--quick",
      "--rt",
      "[a-z_]+(.+)",
      "$1"
    ])
  })

  it("参数映射为配置并列出未识别项", () => {
    const { config, unknown } = argsToConfig([
      "--axios",
      "--responses",
      "-rpi",
      "0",
      "-erq",
      "arg0",
      "-err",
      "--js",
      "-cg",
      "-rp",
      "-rt",
      "[a-z_]+(.+)",
      "",
      "--unknown-flag"
    ])
    expect(config.client.type).toBe("axios")
    expect(config.types).toMatchObject({ responses: true, extractQuery: "arg0", extractResponseRaw: true })
    expect(config.naming).toMatchObject({ pathPrefixIndex: 0, convertGetToQuery: true, dropPathParams: true, tagRewrite: ["[a-z_]+(.+)", ""] })
    expect(config.language.target).toBe("js")
    expect(unknown).toEqual(["--unknown-flag"])
  })

  it("从 package.json 脚本迁移并丢弃 shell 占位符", () => {
    const root = makeTree({
      "package.json": JSON.stringify({ scripts: { api: `swagger2api --axios --quick "$1"` }, typecheck: "tsc" })
    })
    const result = migrateFromPackage(path.join(root, "package.json"))
    expect(result.scriptName).toBe("api")
    expect(result.config.client.type).toBe("axios")
    expect(result.unknown).toEqual([])
  })
})
