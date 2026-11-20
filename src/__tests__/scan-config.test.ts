// 配置文件扫描：在临时目录构造目录结构，用例结束后统一清理
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { scanConfigFiles } from "../utils/common"

/** 用例创建的临时目录，结束后统一删除 */
const roots: string[] = []

/**
 * 构造临时目录结构
 * @param files 相对路径列表
 * @return 临时根目录
 */
function makeTree(files: string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "saconfig-"))
  roots.push(root)
  for (const file of files) {
    const full = path.join(root, file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, "{}")
  }
  return root
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe("配置文件扫描", () => {
  it("命中根目录与任意层级的 saconfig*.json", () => {
    const root = makeTree(["saconfig.json", "a/b/saconfig.web.json", "a/other.json"])
    expect(scanConfigFiles(root)).toEqual([path.join("a", "b", "saconfig.web.json"), "saconfig.json"].sort())
  })

  it("跳过 node_modules 目录", () => {
    const root = makeTree(["saconfig.json", "node_modules/dep/saconfig.json"])
    expect(scanConfigFiles(root)).toEqual(["saconfig.json"])
  })

  it("跳过点开头目录", () => {
    const root = makeTree(["saconfig.json", ".cache/saconfig.json"])
    expect(scanConfigFiles(root)).toEqual(["saconfig.json"])
  })

  it("结果按字典序排序，保证交互式选择顺序稳定", () => {
    const root = makeTree(["b/saconfig.json", "a/saconfig.json", "saconfig.json"])
    expect(scanConfigFiles(root)).toEqual([path.join("a", "saconfig.json"), path.join("b", "saconfig.json"), "saconfig.json"])
  })
})
