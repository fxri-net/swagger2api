// 分组命名契约：非法字符、保留名、重名、超长与手工覆盖的确定性行为
import { describe, expect, it } from "vitest"
import { buildGroupNaming, findOrphanModules, foldGroupKey, slugifyGroupName, toClassName } from "../utils/naming"

describe("名称派生", () => {
  it("中文原样保留为合法标识符", () => {
    const { slug } = slugifyGroupName("用户管理")
    expect(slug).toBe("用户管理")
    expect(toClassName(slug)).toBe("用户管理")
  })

  it("路径字符与标点只作分隔", () => {
    const { slug } = slugifyGroupName("管理端/其他功能/“510”红名单管理")
    expect(slug.includes("/")).toBe(false)
    expect(slug.includes("“")).toBe(false)
    expect(slug).toBe("管理端其他功能510红名单管理")
  })

  it("数字开头补前缀", () => {
    expect(slugifyGroupName("20孵化器").slug).toBe("g20孵化器")
  })

  it("纯符号回落为空串，由命名表分配兜底组", () => {
    expect(slugifyGroupName("★☆").slug).toBe("")
    const { entries } = buildGroupNaming(["★☆", "[★]"])
    expect(entries.map((entry) => entry.fileName)).toEqual(["Group1", "Group2"])
    expect(entries.every((entry) => entry.source === "fallback")).toBe(true)
  })

  it("与全局类型同名的组只改类名，聚合属性保持原样", () => {
    const { entries } = buildGroupNaming(["file", "date"])
    // 类名追加序号避免在同文件内遮蔽全局 File / Date，属性名仍供 request.file 使用
    expect(entries.map((entry) => entry.fileName)).toEqual(["Date2", "File2"])
    expect(entries.map((entry) => entry.property)).toEqual(["date", "file"])
  })

  it("超长截断带稳定哈希，重复调用一致", () => {
    const raw = "组".repeat(80)
    const first = slugifyGroupName(raw)
    const second = slugifyGroupName(raw)
    expect([...first.slug].length).toBeLessThanOrEqual(64)
    expect(first.slug).toBe(second.slug)
    expect(first.reason).toContain("超长截断")
  })
})

describe("命名表", () => {
  it("全角与半角同名组各自独立并追加序号", () => {
    const { entries } = buildGroupNaming(["企业(团队)管理", "企业（团队）管理"])
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((entry) => entry.fileName)).size).toBe(2)
    expect(entries[1].fileName).toBe(`${entries[0].fileName}2`)
  })

  it("仅大小写不同的组不合并", () => {
    const { entries } = buildGroupNaming(["user", "User"])
    expect(entries.map((entry) => entry.fileName)).toEqual(["User", "User2"])
  })

  it("产物保留名与 Windows 设备名追加后缀", () => {
    const { entries } = buildGroupNaming(["index", "con", "HttpClient", "client", "types"])
    expect(entries.map((entry) => entry.fileName)).toEqual(["HttpClient2", "Client2", "Con2", "Index2", "Types2"])
  })

  it("聚合成员保留名追加后缀并说明原因", () => {
    const { entries } = buildGroupNaming(["instance", "request"])
    expect(entries.map((entry) => entry.property)).toEqual(["instance2", "request2"])
    expect(entries.every((entry) => entry.reason.includes("与聚合成员同名"))).toBe(true)
  })

  it("驼峰聚合成员保留名按大小写不敏感处理", () => {
    const { entries } = buildGroupNaming(["setSecurityData", "SecurityData", "http"])
    expect(entries.map((entry) => entry.property)).toEqual(["securityData2", "http2", "setSecurityData2"])
    expect(entries.every((entry) => entry.reason.includes("与聚合成员同名"))).toBe(true)
  })

  it("手工名命中聚合成员保留名时报错", () => {
    const { errors } = buildGroupNaming(["甲"], { 甲: "setSecurityData" })
    expect(errors.some((error) => error.includes("与聚合成员同名"))).toBe(true)
  })

  it("手工覆盖优先，且支持折叠键匹配", () => {
    const { entries, warnings } = buildGroupNaming(["企业（团队）管理"], { "企业(团队)管理": "enterpriseTeam", 未出现: "unused" })
    expect(entries[0].fileName).toBe("EnterpriseTeam")
    expect(entries[0].property).toBe("enterpriseTeam")
    expect(entries[0].source).toBe("manual")
    expect(warnings.some((warning) => warning.includes("未出现"))).toBe(true)
  })

  it("手工名互相冲突时报错而不是静默加序号", () => {
    const { errors } = buildGroupNaming(["甲", "乙"], { 甲: "same", 乙: "same" })
    expect(errors.some((error) => error.includes("手工名冲突"))).toBe(true)
  })

  it("同一输入两次构造结果完全一致", () => {
    const groups = ["用户管理", "管理端/其他功能", "20孵化器", "user", "User"]
    expect(buildGroupNaming(groups)).toEqual(buildGroupNaming(groups))
  })
})

describe("表外产物", () => {
  it("排除固定产物与命名表内模块，只返回残留文件", () => {
    const { entries } = buildGroupNaming(["用户管理"])
    const files = ["index.ts", "index.d.ts", "client.ts", "data-contracts.ts", "http-client.ts", "route-types.ts", "用户管理.ts", "user_Route.ts", "旧模块.ts"]
    expect(findOrphanModules(files, entries, ".ts")).toEqual(["旧模块.ts"])
  })
})

describe("折叠键", () => {
  it("归一化全半角与分隔符", () => {
    expect(foldGroupKey("企业（团队）管理")).toBe(foldGroupKey("企业(团队)管理"))
    expect(foldGroupKey("User_Manage")).toBe("usermanage")
  })
})
