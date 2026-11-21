// 多目标配置：defaults 合并、目标校验、输出目录冲突与命令行目标选择
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { deepMerge, hasTargets, pickTargetFlag, resolveTargets } from "../utils/targets"

/** 用例创建的临时目录，结束后清理 */
const roots: string[] = []

/**
 * 创建临时目录结构
 * @param files 相对路径与内容
 * @return 临时根目录
 */
function makeTree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s2a-targets-"))
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

describe("目标解析", () => {
  it("defaults 提供公共口径，目标项覆盖并解析相对路径", () => {
    const root = makeTree({ "lc.json": "{}" })
    const plan = resolveTargets(
      {
        defaults: { output: "./src/api", mode: "grouped", client: "axios" },
        targets: [
          { id: "base", url: "https://example.com/base.json", output: "./src/api/base" },
          { id: "lc", file: "./lc.json", name: "lcApi", output: "./src/api/lc" }
        ]
      },
      { configDir: root }
    )
    expect(plan.errors).toEqual([])
    expect(plan.targets.map((target) => target.id)).toEqual(["base", "lc"])
    expect(plan.targets[0].outputDir).toBe(path.join(root, "src", "api", "base"))
    expect(plan.targets[0].config.output).toMatchObject({ name: "index", mode: "grouped" })
    expect(plan.targets[0].config.client).toEqual({ type: "axios" })
    expect(plan.targets[1].input).toBe(path.join(root, "lc.json"))
    expect(plan.targets[1].outputDir).toBe(path.join(root, "src", "api", "lc"))
    expect(plan.targets[1].name).toBe("lcApi")
    // 预校验只读：不创建输出目录
    expect(fs.existsSync(path.join(root, "src"))).toBe(false)
  })

  it("命名预设覆盖目标配置", () => {
    const root = makeTree({})
    const plan = resolveTargets(
      {
        profiles: { admin: { client: { type: "axios" } } },
        targets: [{ id: "base", url: "https://example.com/base.json", output: "./api/base" }]
      },
      { configDir: root, profile: "admin" }
    )
    expect(plan.errors).toEqual([])
    expect(plan.targets[0].config.client.type).toBe("axios")
  })

  it("缺少 id、重复 id 与缺少输入都给出明确错误", () => {
    const root = makeTree({})
    const plan = resolveTargets(
      {
        targets: [{ url: "https://example.com/a.json" }, { id: "a", url: "https://example.com/a.json" }, { id: "a", url: "https://example.com/b.json" }, { id: "b" }]
      },
      { configDir: root }
    )
    expect(plan.errors).toContain("targets[0]：缺少 id")
    expect(plan.errors).toContain("目标 id 重复：a")
    expect(plan.errors).toContain("目标 b：缺少 input.url 或 input.file")
  })

  it("本地输入不存在时预校验失败", () => {
    const root = makeTree({})
    const plan = resolveTargets({ targets: [{ id: "base", file: "./missing.json" }] }, { configDir: root })
    expect(plan.errors.some((error) => error.includes("输入文件不存在"))).toBe(true)
  })

  it("输出目录相同或互相嵌套都拒绝生成", () => {
    const root = makeTree({})
    const same = resolveTargets(
      {
        targets: [
          { id: "a", url: "https://example.com/a.json", output: "./api" },
          { id: "b", url: "https://example.com/b.json", output: "./api" }
        ]
      },
      { configDir: root }
    )
    expect(same.errors.some((error) => error.includes("输出目录相同"))).toBe(true)
    const nested = resolveTargets(
      {
        targets: [
          { id: "a", url: "https://example.com/a.json", output: "./api" },
          { id: "b", url: "https://example.com/b.json", output: "./api/base" }
        ]
      },
      { configDir: root }
    )
    expect(nested.errors.some((error) => error.includes("互相嵌套"))).toBe(true)
  })

  it("targets 为空或根上写了目标字段时分别报错与告警", () => {
    const root = makeTree({})
    expect(resolveTargets({ targets: [] }, { configDir: root }).errors).toEqual(["targets 必须是非空数组"])
    const plan = resolveTargets({ url: "https://example.com/root.json", targets: [{ id: "a", url: "https://example.com/a.json" }] }, { configDir: root })
    expect(plan.warnings.some((warning) => warning.includes("根上的 url"))).toBe(true)
  })
})

describe("目标声明与合并", () => {
  it("hasTargets 以是否声明 targets 为准", () => {
    expect(hasTargets({ targets: [] })).toBe(true)
    expect(hasTargets({})).toBe(false)
    expect(hasTargets(null)).toBe(false)
  })

  it("深度合并对象、整体替换数组", () => {
    expect(deepMerge({ output: { dir: "./api", mode: "single" }, naming: { tagRewrite: ["a", "b"] } }, { output: { dir: "./base" }, naming: { tagRewrite: ["c", "d"] } })).toEqual({
      output: { dir: "./base", mode: "single" },
      naming: { tagRewrite: ["c", "d"] }
    })
  })

  it("--target 只接受一个目标 id", () => {
    expect(pickTargetFlag(["--target", "base"])).toEqual({ id: "base", errors: [] })
    expect(pickTargetFlag(["--target"])).toEqual({ errors: ["--target 缺少目标 id"] })
    expect(pickTargetFlag(["--target", "a", "--target", "b"]).errors[0]).toContain("只能指定一个")
  })
})
