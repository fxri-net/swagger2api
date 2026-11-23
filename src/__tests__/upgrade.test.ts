// 一键迁移：旧配置归一、脚本参数收敛、备份恢复与参数解析
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
  it("按命令值收敛参数，保留全部脚本与键名", async () => {
    const root = makeTree({
      "tim.json": "{}",
      "saconfig.json": JSON.stringify({ url: "https://example.com/a.json", output: "./api/a", name: "index", client: "axios", responses: true }),
      "saconfig.tim.json": JSON.stringify({ file: "./tim.json", output: "./api/tim" }),
      "package.json": JSON.stringify({
        scripts: {
          gen: "swagger2api --config saconfig.json",
          "gen:tim": "swagger2api --config saconfig.tim.json --name timApi",
          "audit:api": "swagger2api --config saconfig.json --check",
          grouping: "swagger2api grouping",
          remote: "npx swagger2api --config saconfig.json --axios --profile prod"
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
    // 脚本全部保留，只替换已收敛进配置的参数
    expect(pkg.scripts.gen).toBe("swagger2api --target main")
    expect(pkg.scripts["gen:tim"]).toBe("swagger2api --target tim")
    expect(pkg.scripts["audit:api"]).toBe("swagger2api --config saconfig.json --check")
    expect(pkg.scripts.grouping).toBe("swagger2api grouping")
    expect(pkg.scripts.remote).toBe("npx swagger2api --profile prod --target main")
    expect(fs.existsSync(path.join(root, "saconfig.json"))).toBe(false)

    // 幂等与复检
    expect(await runUpgrade({ cwd: root, yes: true })).toBe(0)
    expect(await runUpgrade({ cwd: root, check: true })).toBe(0)

    // 备份恢复
    expect(await runUpgrade({ cwd: root, restore: "latest" })).toBe(0)
    expect(fs.existsSync(path.join(root, "saconfig.json"))).toBe(true)
    expect(fs.existsSync(path.join(root, "swagger2api.json"))).toBe(false)
    const restored = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    expect(restored.scripts["gen:tim"]).toBe("swagger2api --config saconfig.tim.json --name timApi")
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
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    // 无个性化参数的脚本原样保留
    expect(pkg.scripts.api).toBe("swagger2api")
  })

  it("按 --url 唯一匹配目标文档", async () => {
    const root = makeTree({
      "saconfig.a.json": JSON.stringify({ url: "https://example.com/a.json", output: "./api/a" }),
      "saconfig.b.json": JSON.stringify({ url: "https://example.com/b.json", output: "./api/b" }),
      "package.json": JSON.stringify({ scripts: { sync: "swagger2api --url https://example.com/b.json --name bApi" } })
    })
    expect(await runUpgrade({ cwd: root, yes: true })).toBe(0)
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    expect(pkg.scripts.sync).toBe("swagger2api --target b")
    const config = JSON.parse(fs.readFileSync(path.join(root, "swagger2api.json"), "utf8"))
    expect(config.docs.find((doc: { id: string }) => doc.id === "b").output).toEqual({ dir: "./api/b", name: "bApi" })
  })

  it("平台后缀命令只替换参数并保留前缀", async () => {
    const root = makeTree({
      "saconfig.json": JSON.stringify({ url: "https://example.com/a.json", output: "./api/a" }),
      "package.json": JSON.stringify({ scripts: { "gen:win": "swagger2api.cmd --config saconfig.json --axios" } })
    })
    expect(await runUpgrade({ cwd: root, yes: true })).toBe(0)
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    expect(pkg.scripts["gen:win"]).toBe("swagger2api.cmd")
  })

  it("多文档无法唯一确定目标时保留原脚本并阻断", async () => {
    const root = makeTree({
      "saconfig.a.json": JSON.stringify({ url: "https://example.com/a.json", output: "./api/a" }),
      "saconfig.b.json": JSON.stringify({ url: "https://example.com/b.json", output: "./api/b" }),
      "package.json": JSON.stringify({ scripts: { gen: "swagger2api --responses" } })
    })
    const before = fs.readFileSync(path.join(root, "package.json"), "utf8")
    expect(await runUpgrade({ cwd: root, yes: true })).toBe(1)
    expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(before)
    expect(fs.existsSync(path.join(root, "swagger2api.json"))).toBe(false)
  })

  it("复合命令与位置参数保留原脚本", async () => {
    const root = makeTree({
      "saconfig.json": JSON.stringify({ url: "https://example.com/a.json", output: "./api/a" }),
      "package.json": JSON.stringify({
        scripts: {
          both: "swagger2api --config saconfig.json && echo ok",
          piped: "swagger2api --config saconfig.json | tee log.txt",
          arg: "swagger2api --config saconfig.json $1"
        }
      })
    })
    const before = fs.readFileSync(path.join(root, "package.json"), "utf8")
    expect(await runUpgrade({ cwd: root, yes: true })).toBe(1)
    expect(fs.readFileSync(path.join(root, "package.json"), "utf8")).toBe(before)
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
