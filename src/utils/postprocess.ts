import fs from "node:fs"
import path from "node:path"

// 生成后的代码处理：业务仓要求类型检查接管生成物时，剥离生成器写入的 @ts-nocheck。
// 处理范围限于输出目录内的 .ts / .js / .d.ts，生成与 --check 临时产物走同一管线。
/** 生成器写入的类型检查关闭注释 */
const NO_CHECK_LINE = "// @ts-nocheck"
/** 需要处理的文件后缀（.d.ts 先于 .ts 匹配） */
const CODE_SUFFIXES = [".d.ts", ".ts", ".js"]

/**
 * 递归收集目录内的代码文件（相对路径，统一 / 分隔）。
 * @param dir 目录
 * @param base 基准目录
 * @return 相对路径列表
 */
function collectCodeFiles(dir: string, base = dir): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // 依赖目录不参与生成物处理
      if (entry.name === "node_modules") continue
      files.push(...collectCodeFiles(full, base))
      continue
    }
    if (CODE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) files.push(path.relative(base, full).split(path.sep).join("/"))
  }
  return files.sort()
}

/**
 * 剥离输出目录内的 @ts-nocheck 注释行。
 * 只删除独立成行的注释，行内代码保持原样。
 * @param dir 输出目录
 * @return 实际改写的相对路径（排序）
 */
export function stripTsNoCheck(dir: string) {
  const changed: string[] = []
  for (const file of collectCodeFiles(dir)) {
    const target = path.join(dir, file)
    const content = fs.readFileSync(target, "utf8")
    if (!content.includes(NO_CHECK_LINE)) continue
    const lines = content.split(/\r?\n/)
    const kept = lines.filter((line) => line.trim() !== NO_CHECK_LINE)
    if (kept.length === lines.length) continue
    fs.writeFileSync(target, kept.join("\n"))
    changed.push(file)
  }
  return changed
}
