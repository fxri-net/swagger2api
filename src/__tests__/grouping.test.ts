// 分组决策：规则 / tag / 路径段三种策略与阈值合并
import { describe, expect, it } from "vitest"
import { applyGrouping, matchGroup } from "../utils/grouping"

/**
 * 构造最小文档
 * @param paths 路径与标签
 * @return 文档对象
 */
function makeSpec(paths: Array<{ path: string; tag: string }>) {
  const spec: Record<string, any> = { paths: {} }
  paths.forEach(({ path, tag }, index) => {
    spec.paths[path] = { get: { tags: [tag], operationId: `op${index}` } }
  })
  return spec
}

describe("分组匹配", () => {
  it("显式规则优先于 tag 与路径", () => {
    const spec = makeSpec([{ path: "/admin/user/list", tag: "用户" }])
    const operation = spec.paths["/admin/user/list"].get
    expect(matchGroup("/admin/user/list", operation, { strategy: ["rules", "tag", "path"], rules: [{ match: { prefix: "/admin" }, group: "后台" }], pathDepth: 0 }).group).toBe("后台")
  })

  it("tag 策略取首个标签", () => {
    expect(matchGroup("/a/b", { tags: ["订单"] }, { strategy: ["tag"] }).group).toBe("订单")
  })

  it("路径策略按深度取段", () => {
    expect(matchGroup("/api/v1/order/list", { tags: [] }, { strategy: ["path"], pathDepth: 1 }).group).toBe("v1")
  })

  it("未命中时落到兜底组", () => {
    expect(matchGroup("/a/b", { tags: [] }, { strategy: ["path"], pathDepth: 5, fallback: "misc" }).group).toBe("misc")
  })

  it("返回命中来源与规则下标", () => {
    const match = matchGroup("/admin/user", { tags: [] }, { strategy: ["rules"], rules: [{ match: { prefix: "/other" }, group: "甲" }, { match: { prefix: "/admin" }, group: "乙" }] })
    expect(match).toEqual({ group: "乙", source: "rules", ruleIndex: 1 })
  })
})

describe("分组应用", () => {
  it("重写 tags 并统计组内路由数", () => {
    const spec = makeSpec([
      { path: "/app/a", tag: "应用" },
      { path: "/app/b", tag: "应用" },
      { path: "/home/c", tag: "首页" }
    ])
    const { counts, originalTags } = applyGrouping(spec, { strategy: ["tag"] })
    expect(counts).toEqual({ 应用: 2, 首页: 1 })
    expect(spec.paths["/app/a"].get.tags).toEqual(["应用"])
    // 原始标签按「方法:路径」保留，供 JSDoc 展示
    expect(originalTags["GET:/app/a"]).toBe("应用")
  })

  it("低于 minRoutes 的组并入兜底组", () => {
    const spec = makeSpec([
      { path: "/app/a", tag: "应用" },
      { path: "/app/b", tag: "应用" },
      { path: "/home/c", tag: "首页" }
    ])
    const { counts } = applyGrouping(spec, { strategy: ["tag"], minRoutes: 2, fallback: "misc" })
    expect(counts).toEqual({ 应用: 2, misc: 1 })
    expect(spec.paths["/home/c"].get.tags).toEqual(["Misc"])
  })

  it("超过 maxRoutes 的组按下一段路径再拆", () => {
    const spec = makeSpec([
      { path: "/order/a/x", tag: "订单" },
      { path: "/order/b/y", tag: "订单" }
    ])
    const { counts } = applyGrouping(spec, { strategy: ["path"], pathDepth: 0, maxRoutes: 1 })
    expect(Object.keys(counts).sort()).toEqual(["order_a", "order_b"])
  })
})
