import fs from "node:fs"
import path from "node:path"

// 生成横幅：既标识产物归属（清理、手写护栏与 --check 依赖它），也向读者说明来源。
// 默认输出中文；英文锚点长期保留，用于识别历史产物与上游生成器写入的文件头。

/** 横幅语言 */
export type BannerLanguage = "zh" | "en"
/** 英文横幅锚点（历史产物与上游生成器） */
export const GENERATED_BANNER = "THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API"
/** 中文横幅锚点（默认输出） */
export const GENERATED_BANNER_ZH = "本文件由 swagger-typescript-api 生成，请勿手改"

/**
 * 取目标语言的横幅锚点。
 * @param language 横幅语言
 * @return 锚点文本
 */
export function bannerAnchor(language: BannerLanguage = "zh") {
  return language === "en" ? GENERATED_BANNER : GENERATED_BANNER_ZH
}

/**
 * 本工具自写文件的固定头。
 * @param language 横幅语言
 * @return 三行文件头
 */
export function generatedHeader(language: BannerLanguage = "zh") {
  return ["/* eslint-disable */", "/* tslint:disable */", `/* ## ${bannerAnchor(language)} ## */`]
}

/** 横幅块（多行注释） */
const BANNERS: Record<BannerLanguage, string[]> = {
  zh: [
    "/*",
    " * ---------------------------------------------------------------",
    " * ## 本文件由 swagger-typescript-api 生成，请勿手改              ##",
    " * ## 生成工具：@fxri/swagger2api；来源：swagger-typescript-api ##",
    " * ---------------------------------------------------------------",
    " */"
  ],
  en: [
    "/*",
    " * ---------------------------------------------------------------",
    " * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##",
    " * ##                                                           ##",
    " * ## AUTHOR: acacode                                           ##",
    " * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##",
    " * ---------------------------------------------------------------",
    " */"
  ]
}
/** 注释块 */
const COMMENT_BLOCK = /\/\*[\s\S]*?\*\//g
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
  const target = BANNERS[language].join("\n")
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
      if (match[0].includes(GENERATED_BANNER) || match[0].includes(GENERATED_BANNER_ZH)) {
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
