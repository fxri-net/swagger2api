import { escapeJsStringLiteral } from "./escape-js-string-literal"
import { escapeJsTemplateLiteralStatic } from "./escape-js-template-literal-with-path-params"
import {
  fetchRemoteSchemaResponse,
  isRemoteSchemaFetchAllowed,
  type FetchLike,
  type HostResolver,
  defaultHostResolver
} from "./remote-schema-fetch"

/** 守卫选项 */
export interface SpecGuardOptions {
  /** 文档来源地址（网络来源时用于同源判定与相对引用解析） */
  baseUrl?: string
  /** 地址解析实现（测试可注入） */
  resolve?: HostResolver
  /** 请求实现（测试可注入） */
  fetchImpl?: FetchLike
}

/** 守卫结果 */
export interface SpecGuardResult {
  /** 收集到的错误，非空即应终止该文档的生成 */
  errors: string[]
}

/** 双引号字面量中会导致越界的字符 */
const UNSAFE_LITERAL = /["\\\u0000-\u001f]/

/**
 * 转义会被写入代码字面量的 spec 字段：路径、servers 地址、枚举值与默认值。
 * 与官方 13.12.2 的修复一一对应（路径用模板字面量转义，其余用字符串字面量转义）。
 * @param data 文档对象（原地修改）
 * @return 无
 */
export function escapeSpecValues(data: Record<string, any>) {
  if (data.paths && typeof data.paths === "object") {
    const escapedPaths: Record<string, any> = {}
    for (const [routePath, pathItem] of Object.entries(data.paths)) {
      escapedPaths[escapeJsTemplateLiteralStatic(routePath)] = pathItem
    }
    data.paths = escapedPaths
  }
  if (Array.isArray(data.servers)) {
    for (const server of data.servers) {
      if (server && typeof server.url === "string") server.url = escapeJsStringLiteral(server.url)
    }
  }
  walkValues(data)
}

/**
 * 递归转义枚举值与默认值。
 * @param node 任意节点
 * @return 无
 */
function walkValues(node: any) {
  if (Array.isArray(node)) {
    node.forEach((item) => walkValues(item))
    return
  }
  if (!node || typeof node !== "object") return
  for (const key of Object.keys(node)) {
    const value = node[key]
    if (key === "enum" && Array.isArray(value)) {
      node[key] = value.map((item) => (typeof item === "string" ? escapeJsStringLiteral(item) : item))
    } else if (key === "default" && typeof value === "string") {
      node[key] = escapeJsStringLiteral(value)
    } else {
      walkValues(value)
    }
  }
}

/**
 * 校验会被当作标识符 / 已格式化字面量输出的字段，含越界字符即报错。
 * 这些位置二次转义会改变语义，因此采用「校验 + 终止」而非转义。
 * @param data 文档对象
 * @return 错误列表
 */
export function validateSpecIdentifiers(data: Record<string, any>) {
  const errors: string[] = []
  const visit = (node: any, label: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${label}[${index}]`))
      return
    }
    if (!node || typeof node !== "object") return
    if (node.properties && typeof node.properties === "object") {
      for (const name of Object.keys(node.properties)) {
        if (UNSAFE_LITERAL.test(name)) errors.push(`${label}.properties：属性名含非法字符：${JSON.stringify(name)}`)
      }
    }
    if (Array.isArray(node.required)) {
      for (const name of node.required) {
        if (typeof name === "string" && UNSAFE_LITERAL.test(name)) errors.push(`${label}.required：必填字段名含非法字符：${JSON.stringify(name)}`)
      }
    }
    if (node.discriminator && typeof node.discriminator === "object") {
      if (typeof node.discriminator.propertyName === "string" && UNSAFE_LITERAL.test(node.discriminator.propertyName)) {
        errors.push(`${label}.discriminator.propertyName：含非法字符：${JSON.stringify(node.discriminator.propertyName)}`)
      }
      if (node.discriminator.mapping && typeof node.discriminator.mapping === "object") {
        for (const key of Object.keys(node.discriminator.mapping)) {
          if (UNSAFE_LITERAL.test(key)) errors.push(`${label}.discriminator.mapping：键含非法字符：${JSON.stringify(key)}`)
        }
      }
    }
    for (const key of Object.keys(node)) visit(node[key], `${label}.${key}`)
  }
  visit(data, "#")
  return errors
}

/**
 * 递归解析并内联外部 `$ref`：按官方策略判定来源，不合规即记录错误。
 * @param data 文档对象（原地修改）
 * @param options 守卫选项
 * @return 错误列表
 */
export async function resolveExternalRefs(data: Record<string, any>, options: SpecGuardOptions = {}) {
  const errors: string[] = []
  const ctx = {
    baseUrl: options.baseUrl,
    resolve: options.resolve ?? defaultHostResolver,
    fetchImpl: options.fetchImpl ?? fetch,
    docs: new Map<string, any>(),
    errors
  }

  /**
   * 递归处理节点中的外部引用。
   * @param node 当前节点
   * @param label 位置描述
   * @param chain 当前引用链（环检测）
   * @return 替换后的节点
   */
  const walk = async (node: any, label: string, chain: string[]): Promise<any> => {
    if (Array.isArray(node)) {
      const result: any[] = []
      for (let index = 0; index < node.length; index += 1) result.push(await walk(node[index], `${label}[${index}]`, chain))
      return result
    }
    if (!node || typeof node !== "object") return node
    const ref = node.$ref
    if (typeof ref === "string" && !ref.startsWith("#")) {
      const replacement = await resolveRef(ref, label, chain)
      return replacement === null ? node : walk(replacement, label, chain)
    }
    for (const key of Object.keys(node)) node[key] = await walk(node[key], `${label}.${key}`, chain)
    return node
  }

  /**
   * 解析单个外部引用。
   * @param ref 引用字符串
   * @param label 位置描述
   * @param chain 当前引用链
   * @return 替换节点或 null
   */
  const resolveRef = async (ref: string, label: string, chain: string[]): Promise<any> => {
    if (!/^https?:\/\//i.test(ref)) {
      errors.push(`${label}：不支持的外部引用（仅允许文档内 #/ 或 http(s)）：${ref}`)
      return null
    }
    const hashIndex = ref.indexOf("#")
    const rawUrl = hashIndex === -1 ? ref : ref.slice(0, hashIndex)
    const pointer = hashIndex === -1 ? "" : ref.slice(hashIndex + 1)
    let absoluteUrl: string
    try {
      absoluteUrl = ctx.baseUrl ? new URL(rawUrl, ctx.baseUrl).toString() : rawUrl
    } catch {
      errors.push(`${label}：无法解析的引用地址：${ref}`)
      return null
    }
    const cacheKey = `${absoluteUrl}#${pointer}`
    if (chain.includes(cacheKey)) {
      errors.push(`${label}：检测到引用环：${[...chain, cacheKey].join(" -> ")}`)
      return null
    }
    const allowed = await isRemoteSchemaFetchAllowed(absoluteUrl, { specSourceUrl: ctx.baseUrl }, ctx.resolve)
    if (!allowed) {
      errors.push(`${label}：拒绝拉取非公网或非信任来源的外部引用：${ref}`)
      return null
    }
    const doc = await loadDoc(absoluteUrl, ctx)
    if (!doc) return null
    const target = readPointer(doc, pointer)
    if (target === undefined) {
      errors.push(`${label}：引用片段不存在：${ref}`)
      return null
    }
    const resolved = await walk(structuredClone(target), label, [...chain, cacheKey])
    const name = registerSchema(data, pointer, resolved, absoluteUrl)
    return name ? { $ref: `#/components/schemas/${name}` } : resolved
  }

  await walk(data, "#", [])
  return errors
}

/**
 * 拉取并解析远端文档，同一地址只拉一次。
 * @param url 地址
 * @param ctx 上下文
 * @return 解析后的文档或 null
 */
async function loadDoc(url: string, ctx: { baseUrl?: string; resolve: HostResolver; fetchImpl: FetchLike; docs: Map<string, any>; errors: string[] }) {
  if (ctx.docs.has(url)) return ctx.docs.get(url)
  const response = await fetchRemoteSchemaResponse(url, {}, { specSourceUrl: ctx.baseUrl }, ctx.resolve, ctx.fetchImpl)
  if (!response?.ok) {
    ctx.errors.push(`外部引用拉取失败：${url}`)
    return null
  }
  const text = await response.text()
  try {
    const doc = JSON.parse(text)
    ctx.docs.set(url, doc)
    return doc
  } catch {
    ctx.errors.push(`外部引用文档仅支持 JSON 格式：${url}`)
    return null
  }
}

/**
 * 按 JSON Pointer 读取片段。
 * @param doc 文档
 * @param pointer 指针（不含前缀 #）
 * @return 片段值或 undefined
 */
function readPointer(doc: any, pointer: string) {
  if (!pointer || pointer === "/") return doc
  let current = doc
  for (const rawSegment of pointer.replace(/^\//, "").split("/")) {
    if (current === null || typeof current !== "object") return undefined
    const segment = decodeURIComponent(rawSegment).replace(/~1/g, "/").replace(/~0/g, "~")
    current = current[segment]
  }
  return current
}

/**
 * 把外部 schema 注册到文档 components，保留官方命名的类型名。
 * @param data 文档对象
 * @param pointer 引用指针
 * @param schema 已解析的 schema
 * @param sourceUrl 来源地址
 * @return 注册后的组件名；非 components/schemas 位置返回 null
 */
function registerSchema(data: Record<string, any>, pointer: string, schema: any, sourceUrl: string) {
  const matched = pointer.match(/^\/components\/schemas\/([^/]+)$/)
  if (!matched) return null
  const name = decodeURIComponent(matched[1]).replace(/~1/g, "/").replace(/~0/g, "~")
  data.components = data.components ?? {}
  data.components.schemas = data.components.schemas ?? {}
  const schemas = data.components.schemas
  if (schemas[name] === undefined) {
    schemas[name] = schema
    return name
  }
  if (JSON.stringify(schemas[name]) === JSON.stringify(schema)) return name
  const stem = (sourceUrl.split("/").pop() ?? "ref").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_$]/g, "_") || "ref"
  let candidate = `${name}_${stem}`
  let index = 2
  while (schemas[candidate] !== undefined && JSON.stringify(schemas[candidate]) !== JSON.stringify(schema)) {
    candidate = `${name}_${stem}_${index}`
    index += 1
  }
  schemas[candidate] = schema
  return candidate
}

/**
 * 生成前守卫：解析外部引用、转义代码字面量、校验标识符字段。
 * @param data 文档对象（原地修改）
 * @param options 守卫选项
 * @return 守卫结果
 */
export async function guardSpec(data: Record<string, any>, options: SpecGuardOptions = {}): Promise<SpecGuardResult> {
  const refErrors = await resolveExternalRefs(data, options)
  escapeSpecValues(data)
  return { errors: [...refErrors, ...validateSpecIdentifiers(data)] }
}
