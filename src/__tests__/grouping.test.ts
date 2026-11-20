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

/**
 * 构造分桶夹具：app / misc 为小命名空间，dg_admin 含版本段与子分类
 * @return 文档对象
 */
function makeSplitSpec() {
  const spec: Record<string, any> = { paths: {} }
  const add = (path: string, tag: string) => {
    spec.paths[path] = { get: { tags: [tag], operationId: path.replace(/[^a-z]+/g, "_") } }
  }
  add("/app/items", "app")
  add("/app/detail", "app")
  ;["user/list", "user/detail", "order/list", "order/detail"].forEach((suffix) => add(`/dg_admin/v3/${suffix}`, "dg_admin"))
  add("/misc/ping", "misc")
  return spec
}

describe("自适应分桶与分片", () => {
  it("未配置 split 时保持一命名空间一文件", () => {
    const result = applyGrouping(makeSplitSpec(), { strategy: ["path"], pathDepth: 0 })
    expect(result.split).toBeUndefined()
    expect(result.entries.map((entry) => entry.fileName).sort()).toEqual(["App", "DgAdmin", "Misc"])
  })

  it("总量低于阈值时只出一个模块文件", () => {
    const result = applyGrouping(makeSplitSpec(), { strategy: ["path"], pathDepth: 0, split: { minRoutes: 100 } })
    expect(result.split?.buckets).toHaveLength(1)
    expect(result.split?.buckets[0].namespaces).toEqual(["app", "dg_admin", "misc"])
    expect(result.split?.namespaces.every((plan) => plan.chunks.length === 0)).toBe(true)
  })

  it("顺序装箱并按尾桶阈值并入前一桶", () => {
    const result = applyGrouping(makeSplitSpec(), {
      strategy: ["path"],
      pathDepth: 0,
      split: { minRoutes: 1, targetRoutes: 2, maxRoutes: 3, minBucketRoutes: 2 }
    })
    expect(result.split?.buckets).toHaveLength(1)
    expect(result.split?.buckets[0]).toMatchObject({ fileName: "App", routes: 3, namespaces: ["app", "misc"] })
  })

  it("超大命名空间按子分类分片并跳过版本段", () => {
    const spec = makeSplitSpec()
    const result = applyGrouping(spec, {
      strategy: ["path"],
      pathDepth: 0,
      split: { minRoutes: 1, targetRoutes: 2, maxRoutes: 3, minBucketRoutes: 2 }
    })
    const shard = result.split?.namespaces.find((plan) => plan.raw === "dg_admin")
    expect(shard?.chunks.map((chunk) => [chunk.fileName, chunk.categories])).toEqual([
      ["DgAdminPart1", ["order"]],
      ["DgAdminPart2", ["user"]]
    ])
    // 第二个标签记录命名空间，桶文件据此渲染多个类
    expect(spec.paths["/dg_admin/v3/user/list"].get.tags).toEqual(["DgAdminPart2", "DgAdmin"])
    expect(spec.paths["/app/items"].get.tags).toEqual(["App", "App"])
    // 聚合入口按门面导入，分片类名同步进生成器命名映射
    expect(result.entries.find((entry) => entry.raw === "dg_admin")?.importFrom).toBe("DgAdmin")
    expect(result.moduleClassNames?.DgAdminPart1).toBe("DgAdminPart1")
    expect(result.moduleClassNames?.dgAdminPart1).toBe("DgAdminPart1")
  })

  it("分类规则决定桶名，未命中归入兜底并告警", () => {
    const result = applyGrouping(makeSplitSpec(), {
      strategy: ["path"],
      pathDepth: 0,
      split: { minRoutes: 1, targetRoutes: 10, categories: [{ name: "管理端", match: { prefix: "dg" } }], fallback: "other" }
    })
    expect(result.split?.buckets.map((bucket) => [bucket.fileName, bucket.namespaces])).toEqual([
      ["管理端", ["dg_admin"]],
      ["Other", ["app", "misc"]]
    ])
    expect(result.warnings.some((warning) => warning.includes("未命中分类"))).toBe(true)
  })

  it("启用 split 时忽略旧阈值并告警", () => {
    const result = applyGrouping(makeSplitSpec(), { strategy: ["path"], pathDepth: 0, minRoutes: 2, split: { minRoutes: 100 } })
    expect(result.warnings.some((warning) => warning.includes("忽略 grouping.minRoutes"))).toBe(true)
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

  it("collapse 开启时合并折叠键相同的组", () => {
    const spec = makeSpec([
      { path: "/opt/list", tag: "甲" },
      { path: "/opt_/list", tag: "乙" }
    ])
    const { counts } = applyGrouping(spec, { strategy: ["path"], pathDepth: 0, collapse: true })
    expect(counts).toEqual({ opt: 2 })
    expect(spec.paths["/opt_/list"].get.tags).toEqual(["Opt"])
  })

  it("collapse 关闭时折叠键相同的组各自独立", () => {
    const spec = makeSpec([
      { path: "/opt/list", tag: "甲" },
      { path: "/opt_/list", tag: "乙" }
    ])
    const { counts } = applyGrouping(spec, { strategy: ["path"], pathDepth: 0 })
    expect(Object.keys(counts).sort()).toEqual(["opt", "opt_"])
  })
})
