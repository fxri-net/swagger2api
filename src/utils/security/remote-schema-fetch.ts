import * as dns from "node:dns/promises"
import * as net from "node:net"

// 远端 $ref 拉取策略：移植自 swagger-typescript-api 13.12.2 同名模块（MIT），
// 保持与官方修复一致——同源放行、其余仅公网 http(s)、逐跳校验重定向、鉴权头只发同源。
const MAX_REDIRECTS = 5

/** 主机名地址解析 */
export type HostResolver = (hostname: string) => Promise<string[]>
/** 请求实现 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 默认地址解析 */
export const defaultHostResolver: HostResolver = async (hostname) => {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true })
    return records.map((record) => record.address)
  } catch {
    return []
  }
}

/**
 * 判断 IPv4 是否属于私网 / 保留地址。
 * @param ip IPv4 字符串
 * @return 是否为非公网地址
 */
export function isPrivateIpv4(ip: string) {
  const match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return false
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * 判断 IPv6 是否属于私网 / 保留地址（含 IPv4 映射地址）。
 * @param ip IPv6 字符串
 * @return 是否为非公网地址
 */
export function isPrivateIpv6(ip: string) {
  const normalized = ip.toLowerCase()
  if (normalized === "::" || normalized === "::1") return true
  if (normalized.startsWith("fe80:")) return true
  const firstHextet = normalized.split(":")[0] ?? ""
  if (firstHextet >= "fc00" && firstHextet <= "fdff") return true
  const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (ipv4Mapped?.[1]) return isPrivateIpv4(ipv4Mapped[1])
  // URL.hostname 会把 IPv4 映射地址规范成十六进制分组
  const ipv4MappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (ipv4MappedHex?.[1] && ipv4MappedHex?.[2]) {
    const h1 = parseInt(ipv4MappedHex[1], 16)
    const h2 = parseInt(ipv4MappedHex[2], 16)
    return isPrivateIpv4(`${(h1 >> 8) & 0xff}.${h1 & 0xff}.${(h2 >> 8) & 0xff}.${h2 & 0xff}`)
  }
  return false
}

/**
 * 判断地址是否为非公网地址。
 * @param ip IP 字符串
 * @return 是否为非公网地址
 */
export function isPrivateIp(ip: string) {
  const family = net.isIP(ip)
  if (family === 4) return isPrivateIpv4(ip)
  if (family === 6) return isPrivateIpv6(ip)
  return false
}

/**
 * 判断主机名是否为本地回环名。
 * @param hostname 主机名
 * @return 是否被禁止
 */
function isBlockedHostname(hostname: string) {
  const normalized = hostname.toLowerCase()
  return normalized === "localhost" || normalized.endsWith(".localhost")
}

/**
 * 判断远端地址是否可访问（协议、回环、私网三层校验）。
 * @param urlString 目标地址
 * @param resolve 地址解析实现
 * @return 是否允许访问
 */
export async function isPublicRemoteHost(urlString: string, resolve: HostResolver = defaultHostResolver) {
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    return false
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
  // URL.hostname 会给 IPv6 字面量加方括号，net.isIP 与 dns 都不认
  const hostname =
    parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]") ? parsed.hostname.slice(1, -1) : parsed.hostname
  if (isBlockedHostname(hostname)) return false
  if (net.isIP(hostname)) return !isPrivateIp(hostname)
  const addresses = await resolve(hostname)
  if (addresses.length === 0) return false
  return addresses.every((address) => !isPrivateIp(address))
}

/**
 * 判断两个地址是否同源。
 * @param a 地址一
 * @param b 地址二
 * @return 是否同源
 */
export function isSameHttpOrigin(a: string, b: string | undefined) {
  if (typeof b !== "string") return false
  try {
    const urlA = new URL(a)
    const urlB = new URL(b)
    return urlA.protocol === urlB.protocol && urlA.host === urlB.host
  } catch {
    return false
  }
}

/** 远端拉取策略 */
export interface RemoteSchemaFetchPolicy {
  /** 文档来源地址 */
  specSourceUrl?: string
  /** 是否允许与文档地址完全相同（用于首个请求） */
  allowExplicitSpecUrl?: boolean
}

/**
 * 去除地址中的 hash 片段。
 * @param urlString 地址
 * @return 去 hash 后的地址
 */
export function stripUrlHash(urlString: string) {
  return urlString.split("#")[0] || urlString
}

/**
 * 判断某个远端地址是否允许拉取。
 * @param urlString 目标地址
 * @param policy 策略
 * @param resolve 地址解析实现
 * @return 是否允许
 */
export async function isRemoteSchemaFetchAllowed(urlString: string, policy: RemoteSchemaFetchPolicy, resolve: HostResolver = defaultHostResolver) {
  const { specSourceUrl, allowExplicitSpecUrl = false } = policy
  if (allowExplicitSpecUrl && typeof specSourceUrl === "string" && stripUrlHash(urlString) === stripUrlHash(specSourceUrl)) return true
  if (typeof specSourceUrl === "string" && isSameHttpOrigin(urlString, specSourceUrl)) return true
  return isPublicRemoteHost(urlString, resolve)
}

/**
 * 解析重定向地址。
 * @param location Location 头
 * @param baseUrl 当前地址
 * @return 绝对地址或 null
 */
function resolveRedirectUrl(location: string, baseUrl: string) {
  try {
    return new URL(location, baseUrl).toString()
  } catch {
    return null
  }
}

/**
 * 按策略拉取远端文档，手动跟随重定向并逐跳复检。
 * @param urlString 目标地址
 * @param init 请求参数
 * @param policy 策略
 * @param resolve 地址解析实现
 * @param fetchImpl 请求实现
 * @return 响应或 null（被策略拒绝）
 */
export async function fetchRemoteSchemaResponse(
  urlString: string,
  init: RequestInit,
  policy: RemoteSchemaFetchPolicy,
  resolve: HostResolver = defaultHostResolver,
  fetchImpl: FetchLike = fetch
) {
  let currentUrl = urlString
  let redirectCount = 0
  while (true) {
    const allowed = await isRemoteSchemaFetchAllowed(
      currentUrl,
      { specSourceUrl: policy.specSourceUrl, allowExplicitSpecUrl: policy.allowExplicitSpecUrl && redirectCount === 0 },
      resolve
    )
    if (!allowed) return null
    const response = await fetchImpl(currentUrl, { ...init, redirect: "manual" })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location || redirectCount >= MAX_REDIRECTS) return null
      const redirectUrl = resolveRedirectUrl(location, currentUrl)
      if (!redirectUrl) return null
      currentUrl = redirectUrl
      redirectCount += 1
      continue
    }
    return response
  }
}
