import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { dispatch, runSkill } from "../commands"

const originalArgv = process.argv

interface Captured {
  code: number
  stdout: string
  log: string
  err: string
}

// 捕获三个输出通道，避免测试向终端刷屏
function capture(run: () => number): Captured {
  const stdout: string[] = []
  const log: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout.push(typeof chunk === "string" ? chunk : String(chunk))
    return true
  }) as unknown as typeof process.stdout.write)
  vi.spyOn(console, "log").mockImplementation((...value: unknown[]) => {
    log.push(value.join(" "))
  })
  vi.spyOn(console, "error").mockImplementation((...value: unknown[]) => {
    err.push(value.join(" "))
  })
  const code = run()
  return { code, stdout: stdout.join(""), log: log.join("\n"), err: err.join("\n") }
}

afterEach(() => {
  process.argv = originalArgv
  vi.restoreAllMocks()
})

describe("skill 定位命令", () => {
  // 版本以技能入口两处声明的真源为准，递增版本时无需改测试
  const skillEntry = join(process.cwd(), "skills", "fxri-swagger2api", "SKILL.md")
  const skillVersion = /^[ \t]+version:[ \t]*"?([^"\r\n]+?)"?[ \t]*$/m.exec(readFileSync(skillEntry, "utf8"))?.[1] ?? ""

  it("默认输出存在的技能入口绝对路径", () => {
    const result = capture(() => runSkill([]))
    expect(result.code).toBe(0)
    const entry = result.log.trim()
    expect(entry.endsWith(join("skills", "fxri-swagger2api", "SKILL.md"))).toBe(true)
    expect(existsSync(entry)).toBe(true)
  })

  it("--print 输出入口全文", () => {
    const result = capture(() => runSkill(["--print"]))
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("name: fxri-swagger2api")
    expect(result.stdout).toContain(`本技能版本 ${skillVersion}`)
  })

  it("--json 输出入口、references 与版本", () => {
    const result = capture(() => runSkill(["--json"]))
    expect(result.code).toBe(0)
    // 结构化结果固定走 stdout，人类日志才走 console.log
    const payload = JSON.parse(result.stdout) as { entry: string; referencesDir: string; version: string }
    expect(existsSync(payload.entry)).toBe(true)
    expect(existsSync(payload.referencesDir)).toBe(true)
    expect(payload.version).toBe(skillVersion)
  })

  it("--print 与 --json 互斥", () => {
    const result = capture(() => runSkill(["--print", "--json"]))
    expect(result.code).toBe(1)
    expect(result.err).toContain("不能同时使用")
  })

  it("从任意工作目录都能定位", () => {
    const cwd = process.cwd()
    const temp = mkdtempSync(join(tmpdir(), "s2a-skill-"))
    try {
      process.chdir(temp)
      const result = capture(() => runSkill([]))
      expect(result.code).toBe(0)
      expect(existsSync(result.log.trim())).toBe(true)
    } finally {
      process.chdir(cwd)
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it("--help 不触发生成并列出 skill 命令", async () => {
    process.argv = ["node", "swagger2api", "--help"]
    const stdout: string[] = []
    vi.spyOn(console, "log").mockImplementation((...value: unknown[]) => {
      stdout.push(value.join(" "))
    })
    let generated = false
    await dispatch(async () => {
      generated = true
    })
    expect(generated).toBe(false)
    expect(stdout.join("\n")).toContain("swagger2api skill")
  })
})

describe("打包清单", () => {
  it("package.json 的 files 含 skills 且声明 agentSkills", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { files: string[]; agentSkills?: string }
    expect(pkg.files).toContain("skills")
    expect(pkg.agentSkills).toBe("./skills")
  })
})
