import fs from "node:fs"
import path from "node:path"

// 生成横幅：既标识产物归属（清理、手写护栏与 --check 依赖它），也向读者说明来源。
// 中文与英文使用同一套横幅结构，仅文案不同；默认输出中文。

/** 横幅语言 */
export type BannerLanguage = "zh" | "en"
/** 英文横幅锚点 */
export const GENERATED_BANNER = "THIS FILE WAS GENERATED VIA @FXRI/SWAGGER2API, DO NOT EDIT"
/** 中文横幅锚点（默认输出） */
export const GENERATED_BANNER_ZH = "本文件由 @fxri/swagger2api 生成，请勿手改"
/** 上游生成器写入的横幅锚点：只用于同轮改写生成器文件，不作为产物归属判据 */
const UPSTREAM_BANNER = "THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API"

/**
 * 计算文本显示宽度：CJK 与全角字符按两列计。
 * @param text 文本
 * @return 显示宽度
 */
function displayWidth(text: string) {
  let width = 0
  for (const char of text) width += /[\u1100-\u11FF\u2E80-\u9FFF\uFF00-\uFFEF]/.test(char) ? 2 : 1
  return width
}

/** 横幅文本区宽度：两种语言取同一宽度，使横幅块逐行对齐 */
const BANNER_WIDTH = Math.max(displayWidth(GENERATED_BANNER), displayWidth(GENERATED_BANNER_ZH))

/**
 * 取目标语言的横幅锚点。
 * @param language 横幅语言
 * @return 锚点文本
 */
export function bannerAnchor(language: BannerLanguage = "zh") {
  return language === "en" ? GENERATED_BANNER : GENERATED_BANNER_ZH
}

/**
 * 取目标语言的横幅块：两种语言结构一致，仅锚点文案不同。
 * @param language 横幅语言
 * @return 横幅块各行
 */
export function bannerBlock(language: BannerLanguage = "zh") {
  const anchor = bannerAnchor(language)
  const border = ` * ${"-".repeat(BANNER_WIDTH + 6)}`
  return ["/*", border, ` * ## ${anchor}${" ".repeat(BANNER_WIDTH - displayWidth(anchor))} ##`, border, " */"]
}

/**
 * 本工具自写文件的固定头：关闭 lint 后接生成横幅。
 * @param language 横幅语言
 * @return 文件头各行
 */
export function generatedHeader(language: BannerLanguage = "zh") {
  return ["/* eslint-disable */", "/* tslint:disable */", ...bannerBlock(language)]
}
/** 注释块 */
const COMMENT_BLOCK = /\/\*[\s\S]*?\*\//g
/** 需要改写的横幅锚点：当前中英锚点与生成器同轮写入的上游锚点 */
const REWRITE_ANCHORS = [GENERATED_BANNER, GENERATED_BANNER_ZH, UPSTREAM_BANNER]
/** 判定横幅时读取的文件头字节数 */
const HEAD_SCAN_BYTES = 2048
/** 需要处理的代码文件后缀 */
const CODE_SUFFIXES = [".d.ts", ".ts", ".js"]

/**
 * 解析横幅语言：缺省中文，非法值告警后回落中文。
 * @param config 配置对象
 * @param warn 告警输出，默认写入 stderr
 * @return 横幅语言
 */
export function resolveBannerLanguage(config: Record<string, any> | null, warn: (message: string) => void = (message) => console.error(`⚠️ ${message}`)): BannerLanguage {
  const raw = config?.output?.banner
  if (raw === undefined) return "zh"
  if (raw === "zh" || raw === "en") return raw
  warn(`output.banner 只支持 zh / en，已忽略 ${String(raw)}，回落到 zh`)
  return "zh"
}

/**
 * 递归收集代码文件（相对路径，统一 / 分隔）。
 * @param dir 目录
 * @param base 基准目录
 * @return 相对路径列表
 */
function collectCodeFiles(dir: string, base = dir): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue
      files.push(...collectCodeFiles(full, base))
      continue
    }
    if (CODE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) files.push(path.relative(base, full).split(path.sep).join("/"))
  }
  return files.sort()
}

/**
 * 改写产物文件头的横幅语言：只动含锚点的首个注释块，其余内容原样保留。
 * @param dir 产物目录
 * @param language 目标语言
 * @return 已改写的相对路径
 */
export function rewriteGeneratedBanners(dir: string, language: BannerLanguage = "zh") {
  if (!fs.existsSync(dir)) return []
  const target = bannerBlock(language).join("\n")
  const anchor = bannerAnchor(language)
  const changed: string[] = []
  for (const file of collectCodeFiles(dir)) {
    const full = path.join(dir, file)
    const source = fs.readFileSync(full, "utf8")
    const head = source.slice(0, HEAD_SCAN_BYTES)
    COMMENT_BLOCK.lastIndex = 0
    let match: RegExpExecArray | null
    let block: RegExpExecArray | null = null
    while ((match = COMMENT_BLOCK.exec(head))) {
      const found = match[0]
      if (REWRITE_ANCHORS.some((item) => found.includes(item))) {
        block = match
        break
      }
    }
    if (!block) continue
    if (block[0].includes(anchor)) continue
    fs.writeFileSync(full, `${source.slice(0, block.index)}${target}${source.slice(block.index + block[0].length)}`)
    changed.push(file)
  }
  return changed
}
