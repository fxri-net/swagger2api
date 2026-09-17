import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// 站点更新日志镜像：把根 CHANGELOG.md 全量历史同步进 docs/changelog.md。
// 幂等纯字符串转换，发版润色 CHANGELOG 后执行一次即可；本文件不入 npm 包（files 白名单不含 scripts）
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8").replace(/^\uFEFF/, "")

// 丢弃源文件标题行（# @fxri/swagger2api），保留首个版本块起的全部历史
// 换行按 CRLF 兼容处理：根 CHANGELOG.md 在 Windows 检出为 CRLF，只吃 \n 会残留 \r 生成空行
const body = changelog.replace(/^#\s+[^\r\n]*(?:\r?\n)+/, "").trimEnd() + "\n"

// 目录只列到 h2（版本号）：本页版本块多且每块下还有 h3 分组，放开到 h3 目录会过长
const page =
  "---\n" +
  "outline: [2, 2]\n" +
  "---\n\n" +
  "# 更新日志\n\n" +
  "> 完整变更历史以随包发布的 CHANGELOG.md 为准，本页由 `pnpm sync:changelog-doc` 从根 CHANGELOG.md 自动同步，请勿手改。\n\n" +
  body

writeFileSync(join(root, "docs", "changelog.md"), page)
