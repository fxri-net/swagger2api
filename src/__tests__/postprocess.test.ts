// 类型检查策略：剥离生成物中的 @ts-nocheck，只处理独立成行的注释
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { stripTsNoCheck } from "../utils/postprocess"

/** 用例创建的临时目录，结束后清理 */
const roots: string[] = []

/**
 * 创建临时目录结构
 * @param files 相对路径与内容
 * @return 临时根目录
 */
function makeTree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s2a-postprocess-"))
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

describe("类型检查策略", () => {
  it("剥离 .ts / .js / .d.ts 中独立成行的注释", () => {
    const root = makeTree({
      "index.ts": "/* eslint-disable */\n// @ts-nocheck\nexport const a = 1\n",
      "types/index.d.ts": "// @ts-nocheck\nexport type A = string\n",
      "client.js": "  // @ts-nocheck\nmodule.exports = {}\n",
      "notes.md": "// @ts-nocheck\n"
    })
    expect(stripTsNoCheck(root)).toEqual(["client.js", "index.ts", "types/index.d.ts"])
    expect(fs.readFileSync(path.join(root, "index.ts"), "utf8")).toBe("/* eslint-disable */\nexport const a = 1\n")
    expect(fs.readFileSync(path.join(root, "types/index.d.ts"), "utf8")).toBe("export type A = string\n")
    // 非代码文件不在处理范围
    expect(fs.readFileSync(path.join(root, "notes.md"), "utf8")).toContain("@ts-nocheck")
  })

  it("行内注释与无该注释的文件保持原样", () => {
    const root = makeTree({
      "index.ts": "// @ts-nocheck is not inline\nexport const a = 1 // @ts-nocheck\n",
      "other.ts": "export const b = 2\n"
    })
    expect(stripTsNoCheck(root)).toEqual([])
    expect(fs.readFileSync(path.join(root, "index.ts"), "utf8")).toContain("export const a = 1 // @ts-nocheck")
  })

  it("重复执行结果稳定", () => {
    const root = makeTree({ "index.ts": "// @ts-nocheck\nexport const a = 1\n" })
    expect(stripTsNoCheck(root)).toEqual(["index.ts"])
    expect(stripTsNoCheck(root)).toEqual([])
  })
})
