// 一键迁移：旧配置归一、脚本收编、备份恢复与参数解析
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { lineDiff, parseUpgradeOptions, runUpgrade } from "../utils/upgrade"

/** 用例创建的临时目录，结束后清理 */
const roots: string[] = []

/**
 * 创建临时目录结构
 * @param files 相对路径与内容
 * @return 临时根目录
 */
function makeTree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "s2a-upgrade-"))
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

describe("行级差异与参数解析", () => {
  it("输出增删行", () => {
    expect(lineDiff("a\nb", "a\nc")).toEqual([" a", "-b", "+c"])
  })

  it("解析 upgrade 参数", () => {
    expect(parseUpgradeOptions(["--dry-run", "--diff", "--yes", "--only", "a,b", "--only", "b", "--cwd", "x"])).toMatchObject({
      dryRun: true,
      diff: true,
      yes: true,
      only: ["a", "b"],
      cwd: "x"
    })
  })
})

describe("旧配置与脚本迁移", () => {
  it("合并 saconfig 与脚本参数，收编为单一 api 脚本", async () => {
    const root = makeTree({
      "tim.json": "{}",
      "saconfig.json": JSON.stringify({ url: "https://example.com/a.json", output: "./api/a", name: "index", client: "axios", responses: true }),
      "saconfig.tim.json": JSON.stringify({ file: "./tim.json", output: "./api/tim" }),
      "package.json": JSON.stringify({
        scripts: {
          api: "swagger2api --config saconfig.json",
          "api:tim": "swagger2api --config saconfig.tim.json --name timApi",
          "api:check": "swagger2api --config saconfig.json --check",
          grouping: "swagger2api grouping"
        }
      })
    })
    expect(await runUpgrade({ cwd: root, yes: true })).toBe(0)
    const config = JSON.parse(fs.readFileSync(path.join(root, "swagger2api.json"), "utf8"))
    const mainDoc = config.docs.find((doc: { id: string }) => doc.id === "main")
    expect(mainDoc.client).toBe("axios")
    expect(mainDoc.types.responses).toBe(true)
    expect(config.docs.map((doc: { id: string }) => doc.id)).toEqual(["main", "tim"])
    expect(config.docs.find((doc: { id: string }) => doc.id === "tim").output).toEqual({ dir: "./api/tim", name: "timApi" })
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    expect(pkg.scripts.api).toBe("swagger2api")
    expect(pkg.scripts["api:tim"]).toBeUndefined()
    expect(pkg.scripts["api:check"]).toBeUndefined()
    expect(pkg.scripts.grouping).toBe("swagger2api grouping")
    expect(fs.existsSync(path.join(root, "saconfig.json"))).toBe(false)

    // 幂等与复检
    expect(await runUpgrade({ cwd: root, yes: true })).toBe(0)
    expect(await runUpgrade({ cwd: root, check: true })).toBe(0)

    // 备份恢复
    expect(await runUpgrade({ cwd: root, restore: "latest" })).toBe(0)
    expect(fs.existsSync(path.join(root, "saconfig.json"))).toBe(true)
    expect(fs.existsSync(path.join(root, "swagger2api.json"))).toBe(false)
    const restored = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    expect(restored.scripts["api:tim"]).toBe("swagger2api --config saconfig.tim.json --name timApi")
  })

  it("旧版 defaults + targets 迁移为 base + docs", async () => {
    const root = makeTree({
      "b.json": "{}",
      "swagger2api.json": JSON.stringify({
        defaults: { output: { name: "index", mode: "grouped" }, client: "axios" },
        targets: [
          { id: "a", url: "https://example.com/a.json", output: "./api/a" },
          { id: "b", file: "./b.json", output: "./api/b" }
        ]
      }),
      "package.json": JSON.stringify({ scripts: { api: "swagger2api" } })
    })
    expect(await runUpgrade({ cwd: root, yes: true })).toBe(0)
    const config = JSON.parse(fs.readFileSync(path.join(root, "swagger2api.json"), "utf8"))
    expect(config.base).toEqual({ client: "axios", output: { name: "index", mode: "grouped" } })
    expect(config.docs).toEqual([
      { id: "a", source: { url: "https://example.com/a.json" }, output: "./api/a" },
      { id: "b", source: { file: "./b.json" }, output: "./api/b" }
    ])
  })

  it("未知脚本参数阻断写入并退出 1", async () => {
    const root = makeTree({
      "saconfig.json": JSON.stringify({ url: "https://example.com/a.json", output: "./api/a" }),
      "package.json": JSON.stringify({ scripts: { api: "swagger2api --unknown-flag" } })
    })
    const before = fs.readFileSync(path.join(root, "package.json"), "utf8")
    expect(await runUpgrade({ cwd: root, yes: true })).toBe(1)
    expect(fs.existsSync(path.join(root, "swagger2api.json"))).toBe(false)
    expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(before)
  })
})
