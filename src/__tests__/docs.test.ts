// 文档列表：base 与文档项合并、入口名优先级、选择参数与目录互斥校验
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { hasDocs, pickDocFlags, resolveDocs, selectDocs, type DocConfig } from "../utils/docs"

/** 用例创建的临时目录，结束后清理 */
const roots: string[] = []

/**
 * 创建临时目录结构
 * @param files 相对路径与内容
 * @return 临时根目录
 */
function makeTree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s2a-docs-"))
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

describe("文档解析", () => {
  it("base 提供共享配置，文档项覆盖，入口名按文档项优先", () => {
    const root = makeTree({ "swagger.json": "{}" })
    const plan = resolveDocs(
      {
        base: { output: { name: "api", mode: "grouped" }, client: "axios", types: { responses: true } },
        docs: [
          { id: "a", source: "./swagger.json", output: "./api/a" },
          { id: "b", source: { file: "./swagger.json", timeout: 500 }, output: { dir: "./api/b", name: "b" } }
        ]
      },
      { configDir: root }
    )
    expect(plan.errors).toEqual([])
    expect(plan.docs.map((doc) => doc.id)).toEqual(["a", "b"])
    expect(plan.docs[0].name).toBe("api")
    expect(plan.docs[1].name).toBe("b")
    expect(plan.docs[1].config.input.timeout).toBe(500)
    expect(plan.docs[0].config.client).toEqual({ type: "axios" })
    expect(plan.docs[0].input).toBe(path.join(root, "swagger.json"))
    expect(fs.existsSync(path.join(root, "api"))).toBe(false)
  })

  it("profile 深度合并进 base", () => {
    const root = makeTree({ "swagger.json": "{}" })
    const plan = resolveDocs(
      {
        base: { output: { name: "api" }, client: "fetch" },
        profiles: { admin: { client: "axios" } },
        docs: [{ id: "a", source: "./swagger.json", output: "./api" }]
      },
      { configDir: root, profile: "admin" }
    )
    expect(plan.errors).toEqual([])
    expect(plan.docs[0].config.client).toEqual({ type: "axios" })
  })

  it("缺 id、重复 id、缺 source / output 与非法 id 都明确报错", () => {
    const root = makeTree({ "swagger.json": "{}" })
    const plan = resolveDocs(
      {
        docs: [
          { source: "./swagger.json", output: "./api" },
          { id: "a", source: "./swagger.json" },
          { id: "a", source: "./swagger.json", output: "./api" },
          { id: "-bad", source: "./swagger.json", output: "./api" },
          { id: "b", output: "./api" }
        ]
      },
      { configDir: root }
    )
    expect(plan.errors).toContain("docs[0]：缺少 id")
    expect(plan.errors).toContain("文档 a：缺少 output（目录字符串或对象）")
    expect(plan.errors).toContain("文档 id 重复：a")
    expect(plan.errors.some((error) => error.includes("id 只允许字母"))).toBe(true)
    expect(plan.errors).toContain("文档 b：缺少 source（字符串或 { url | file }）")
  })

  it("output.name 不得包含路径分隔符或扩展名", () => {
    const root = makeTree({ "swagger.json": "{}" })
    const plan = resolveDocs(
      {
        docs: [
          { id: "a", source: "./swagger.json", output: { dir: "./a", name: "api/index" } },
          { id: "b", source: "./swagger.json", output: { dir: "./b", name: "api.ts" } }
        ]
      },
      { configDir: root }
    )
    expect(plan.errors.some((error) => error.includes("文档 a：output.name 不能包含路径分隔符或扩展名"))).toBe(true)
    expect(plan.errors.some((error) => error.includes("文档 b：output.name 不能包含路径分隔符或扩展名"))).toBe(true)
  })

  it("base 不允许声明 source 与 output.dir", () => {
    const root = makeTree({ "swagger.json": "{}" })
    const plan = resolveDocs(
      { base: { source: "./x.json", output: { dir: "./api" } }, docs: [{ id: "a", source: "./swagger.json", output: "./api" }] },
      { configDir: root }
    )
    expect(plan.errors).toContain("base 不允许声明 source，请写在 docs 项内")
    expect(plan.errors).toContain("base.output 不允许声明 dir，输出目录请写在 docs 项内")
  })

  it("输入文件不存在与输出目录重叠都拒绝", () => {
    const root = makeTree({ "swagger.json": "{}" })
    const missing = resolveDocs({ docs: [{ id: "a", source: "./missing.json", output: "./api" }] }, { configDir: root })
    expect(missing.errors.some((error) => error.includes("输入文件不存在"))).toBe(true)
    const nested = resolveDocs(
      {
        docs: [
          { id: "a", source: "./swagger.json", output: "./api" },
          { id: "b", source: "./swagger.json", output: "./api/base" }
        ]
      },
      { configDir: root }
    )
    expect(nested.errors.some((error) => error.includes("互相嵌套"))).toBe(true)
    const same = resolveDocs(
      {
        docs: [
          { id: "a", source: "./swagger.json", output: "./api" },
          { id: "b", source: "./swagger.json", output: "./api" }
        ]
      },
      { configDir: root }
    )
    expect(same.errors.some((error) => error.includes("输出目录相同"))).toBe(true)
  })
})

describe("文档声明与选择", () => {
  it("hasDocs 以是否声明 docs 为准", () => {
    expect(hasDocs({ docs: [] })).toBe(true)
    expect(hasDocs({})).toBe(false)
    expect(hasDocs(null)).toBe(false)
  })

  it("--target 支持逗号与重复传参并去重", () => {
    expect(pickDocFlags(["--target", "a,b", "--target", "b"])).toEqual({ ids: ["a", "b"], all: false, errors: [] })
    expect(pickDocFlags(["--target"])).toEqual({ ids: [], all: false, errors: ["--target 缺少文档 id"] })
  })

  it("--target 与 --all 不能同时使用", () => {
    expect(pickDocFlags(["--target", "a", "--all"]).errors).toEqual(["--target 与 --all 不能同时使用"])
  })
})

describe("文档选择", () => {
  /** 构造已校验文档 */
  const docs = ["a", "b"].map<DocConfig>((id) => ({
    id,
    input: `/tmp/${id}.json`,
    outputDir: `/tmp/${id}`,
    name: "index",
    config: {}
  }))

  it("单文档直接执行，不提问", () => {
    const selection = selectDocs(docs.slice(0, 1), { ids: [], all: false, errors: [] }, { interactive: false })
    expect(selection).toEqual({ docs: docs.slice(0, 1), errors: [], action: "run" })
  })

  it("多文档非交互必须显式选择", () => {
    expect(selectDocs(docs, { ids: [], all: false, errors: [] }, { interactive: false }).action).toBe("required")
  })

  it("多文档可交互时进入选择", () => {
    expect(selectDocs(docs, { ids: [], all: false, errors: [] }, { interactive: true }).action).toBe("prompt")
  })

  it("--all 全选，--target 子集与逗号重复去重", () => {
    expect(selectDocs(docs, { ids: [], all: true, errors: [] }, { interactive: false }).docs).toEqual(docs)
    const picked = pickDocFlags(["--target", "b,a", "--target", "b"])
    expect(selectDocs(docs, picked, { interactive: false }).docs.map((doc) => doc.id)).toEqual(["a", "b"])
  })

  it("未知 id 与参数冲突给出错误", () => {
    const unknown = selectDocs(docs, { ids: ["nope"], all: false, errors: [] }, { interactive: true })
    expect(unknown.action).toBe("required")
    expect(unknown.errors[0]).toContain("未知文档 nope")
    const conflict = selectDocs(docs, pickDocFlags(["--target", "a", "--all"]), { interactive: true })
    expect(conflict.errors).toEqual(["--target 与 --all 不能同时使用"])
  })
})
