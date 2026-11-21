---
"@fxri/swagger2api": patch
---

- 修复：新增 `surface` 命令，提取产物中的 `@request` / `@name` 与导出类型，支持 `--out` 写基线、`--compare` 比对增删
- 修复：多目标按 `id` 分组，目标集合或格式版本变化按失败处理；`--requests-only` 只锁接口集合
