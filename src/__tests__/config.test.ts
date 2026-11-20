// 配置分层与迁移解析：三层合并、环境变量覆盖、命名预设、脚本参数迁移
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  applyEnvOverrides,
  applyProfile,
  findUpward,
  getByPath,
  loadConfigLayers,
  mergeSections,
  mergeShallow,
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
  it("按段覆盖：外层同名段整体替换", () => {
    expect(mergeSections({ output: { dir: "a", mode: "single" }, client: { type: "fetch" } }, { output: { dir: "b" } })).toEqual({
      output: { dir: "b" },
      client: { type: "fetch" }
    })
  })

  it("段内浅合并：数组整体替换", () => {
    expect(
      mergeShallow({ naming: { tagRewrite: ["a", "b"], convertGetToQuery: false } }, { naming: { tagRewrite: ["c", "d"] } })
    ).toEqual({ naming: { tagRewrite: ["c", "d"], convertGetToQuery: false } })
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

  it("命名预设按字段浅合并", () => {
    const result = applyProfile({ output: { dir: "base", name: "index" }, profiles: { admin: { output: { dir: "admin" } } } }, "admin")
    expect(result.output).toEqual({ dir: "admin", name: "index" })
  })
})

describe("三层加载", () => {
  it("向上查找并合并三层，本地层字段覆盖项目层", () => {
    const root = makeTree({
      ".swagger2apirc.json": JSON.stringify({ input: { url: "project" }, output: { dir: "./api", name: "index" } }),
      ".swagger2apirc.local.json": JSON.stringify({ output: { dir: "./local" } }),
      "apps/admin/package.json": "{}"
    })
    const layers = loadConfigLayers(path.join(root, "apps", "admin"), { homeDir: path.join(root, "home") })
    expect(layers.project.file).toBe(path.join(root, ".swagger2apirc.json"))
    expect(layers.merged?.output).toEqual({ dir: "./local", name: "index" })
    expect(layers.merged?.input).toEqual({ url: "project" })
  })

  it("解析失败的层被忽略并告警", () => {
    const root = makeTree({ ".swagger2apirc.json": "{ bad json" })
    const layers = loadConfigLayers(root, { homeDir: path.join(root, "home") })
    expect(layers.project.hit).toBe(false)
    expect(layers.warnings.length).toBe(1)
  })

  it("findUpward 从子目录命中父级文件", () => {
    const root = makeTree({ ".swagger2apirc.json": "{}", "a/b/c/.keep": "" })
    expect(findUpward(".swagger2apirc.json", path.join(root, "a", "b", "c"))).toBe(path.join(root, ".swagger2apirc.json"))
  })
})

describe("脚本迁移", () => {
  it("切分引号与正则参数", () => {
    expect(tokenizeArgs(`--config saconfig.json --quick --rt "[a-z_]+(.+)" "$1"`)).toEqual([
      "--config",
      "saconfig.json",
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
    expect(config.types).toMatchObject({ responses: true, extractQuery: "arg0", unwrapData: true })
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
