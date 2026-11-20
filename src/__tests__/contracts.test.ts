import { describe, expect, it } from "vitest"
import { buildContractFiles, buildRuntimeFiles, collectContractImports, parseContractSource, planContractOwnership } from "../utils/contracts"

/** 契约样例：含跨声明引用、内部声明、运行时枚举与未使用声明 */
const contract = [
  "/* banner */",
  "export interface Order {",
  "  user?: User",
  "}",
  "export interface User {",
  "  id?: number",
  "}",
  "interface UtilRequiredKeys<T, K> {",
  "  value?: T",
  "  key?: K",
  "}",
  'export enum Status {',
  '  A = "a"',
  "}",
  "export interface Unused {",
  "  id?: number",
  "}"
].join("\n")

describe("契约归属", () => {
  it("按模块导入计算使用方，沿引用传递，未使用进共享", () => {
    const source = parseContractSource(contract)
    const owners = planContractOwnership(source.declarations, [{ file: "Modules", source: 'import { Order } from "./types/index"' }])
    expect(owners.get("Order")).toBe("Modules")
    // Order 引用 User，User 继承使用方
    expect(owners.get("User")).toBe("Modules")
    expect(owners.get("UtilRequiredKeys")).toBe("shared")
    expect(owners.get("Status")).toBe("shared")
    expect(owners.get("Unused")).toBe("shared")
  })

  it("多个模块使用同一契约时进共享", () => {
    const source = parseContractSource(contract)
    const owners = planContractOwnership(source.declarations, [
      { file: "Modules", source: 'import { Order } from "./types/index"' },
      { file: "DgAdmin", source: 'import { User } from "./types/index"' }
    ])
    expect(owners.get("User")).toBe("shared")
    // Order 只被 Modules 使用，不因引用共享类型而跟着进共享
    expect(owners.get("Order")).toBe("Modules")
  })

  it("互引的环得到同一使用方集合，不跨文件", () => {
    const cyclic = ["export interface A {", "  b?: B", "}", "export interface B {", "  a?: A", "}"].join("\n")
    const source = parseContractSource(cyclic)
    const owners = planContractOwnership(source.declarations, [
      { file: "Modules", source: 'import { A } from "./types/index"' },
      { file: "DgAdmin", source: 'import { B } from "./types/index"' }
    ])
    expect(owners.get("A")).toBe(owners.get("B"))
    expect(owners.get("A")).toBe("shared")
  })

  it("读取模块对契约出口的导入名", () => {
    const names = collectContractImports('import type { A, B as C } from "./types/index"\nimport { D } from "./client"')
    expect([...names].sort()).toEqual(["A", "B"])
  })
})

describe("契约拆分", () => {
  const source = parseContractSource(contract)
  const owners = new Map([
    ["Order", "Modules"],
    ["User", "shared"],
    ["UtilRequiredKeys", "shared"],
    ["Status", "shared"],
    ["Unused", "shared"]
  ])

  it("生成文件、跨文件 import 与公开 barrel", () => {
    const files = buildContractFiles(source, owners, { toJS: false })
    expect([...files.keys()].sort()).toEqual(["Modules.ts", "index.ts", "shared.ts"])
    expect(files.get("Modules.ts")).toContain('import type { User } from "./shared"')
    expect(files.get("shared.ts")).toContain("export interface UtilRequiredKeys")
    const barrel = files.get("index.ts") ?? ""
    expect(barrel).toContain('export type { Order } from "./Modules"')
    expect(barrel).toContain('export { Status } from "./shared"')
    expect(barrel).not.toContain("UtilRequiredKeys")
  })

  it("JS 模式枚举进实现文件，barrel 只导出公开面", () => {
    const files = buildContractFiles(source, owners, { toJS: true })
    expect(files.has("Modules.d.ts")).toBe(true)
    expect(files.get("index.js")).toContain('export { Status } from "./shared"')
    expect(files.get("index.js")).not.toContain("Order")
    expect(files.get("index.d.ts")).toContain('export type { Order } from "./Modules"')
  })

  it("拆出运行时枚举并保留挂载逻辑", () => {
    const runtime = [
      "export var Status",
      ';(function (Status) {',
      '  Status["A"] = "a"',
      "})(Status || (Status = {}))",
      "export var Other",
      ";(function (Other) {})",
      "(Other || (Other = {}))"
    ].join("\n")
    const files = buildRuntimeFiles(runtime, new Map([["Status", "Modules"], ["Other", "shared"]]), "")
    expect(files.get("Modules")).toContain('Status["A"] = "a"')
    expect(files.get("Modules")).not.toContain("Other")
    expect(files.get("shared")).toContain("export var Other")
  })
})
