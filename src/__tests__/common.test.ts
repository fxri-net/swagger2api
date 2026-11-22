// 命令行参数解析：模块加载时快照 process.argv，故每个用例重置模块并注入参数后再导入
import { afterEach, describe, expect, it, vi } from "vitest"

/** 原始命令行参数，用例结束后还原 */
const originalArgv = process.argv

/**
 * 以指定参数重新加载参数解析模块
 * @param argv 追加在脚本名之后的参数
 * @return 重新加载后的模块
 */
async function loadCommon(argv: string[]) {
  vi.resetModules()
  process.argv = ["node", "cli", ...argv]
  return import("../utils/common")
}

afterEach(() => {
  process.argv = originalArgv
  vi.restoreAllMocks()
  vi.resetModules()
})

describe("命令行参数解析", () => {
  it("取值：参数名后紧跟的值为键值", async () => {
    const { getPValue } = await loadCommon(["--url", "http://example.com"])
    expect(getPValue("--url")).toBe("http://example.com")
  })

  it("取键：参数存在且值不是 false 即视为开启", async () => {
    const { getPKey } = await loadCommon(["--quick"])
    expect(getPKey("--quick")).toBe(true)
  })

  it("取键：显式 false 视为关闭", async () => {
    const { getPKey } = await loadCommon(["--quick", "false"])
    expect(getPKey("--quick")).toBe(false)
  })

  it("取数组：按声明长度截取参数名之后的连续值", async () => {
    const { getPArray } = await loadCommon(["--tags", "a", "b"])
    expect(getPArray("--tags", { length: 2 })).toEqual(["a", "b"])
  })

  it("未命中时取值返回 undefined、取数组回落为空数组", async () => {
    const { getPValue, getPArray } = await loadCommon(["--url", "x"])
    expect(getPValue("--output")).toBeUndefined()
    expect(getPArray("--missing")).toEqual([])
  })
})

describe("交互判定", () => {
  it("终端可用且未显式关闭时可交互", async () => {
    const { canPrompt } = await loadCommon([])
    expect(canPrompt([], true)).toBe(true)
  })

  it("非终端环境不可交互", async () => {
    const { canPrompt } = await loadCommon([])
    expect(canPrompt([], false)).toBe(false)
  })

  it("--no-interactive 在终端下也关闭交互", async () => {
    const { canPrompt } = await loadCommon([])
    expect(canPrompt(["--no-interactive"], true)).toBe(false)
  })
})

describe("拉取超时解析", () => {
  it("缺省与显式 0 都表示不超时，数字与数字字符串都接受", async () => {
    const { normalizeTimeout, DEFAULT_FETCH_TIMEOUT } = await loadCommon([])
    expect(DEFAULT_FETCH_TIMEOUT).toBe(0)
    expect(normalizeTimeout(undefined)).toBe(0)
    expect(normalizeTimeout(0)).toBe(0)
    expect(normalizeTimeout("5000")).toBe(5000)
    expect(normalizeTimeout(1500)).toBe(1500)
  })

  it("非法值告警并回落默认", async () => {
    const { normalizeTimeout, DEFAULT_FETCH_TIMEOUT } = await loadCommon([])
    const errors: string[] = []
    vi.spyOn(console, "error").mockImplementation((...value: unknown[]) => {
      errors.push(value.join(" "))
    })
    expect(normalizeTimeout("abc")).toBe(DEFAULT_FETCH_TIMEOUT)
    expect(normalizeTimeout(-1)).toBe(DEFAULT_FETCH_TIMEOUT)
    expect(errors.filter((line) => line.includes("已忽略")).length).toBe(2)
  })
})
