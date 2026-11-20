---
"@fxri/swagger2api": minor
---

- 新增：`swagger2api grouping` 展示标签与路径分布，交互式写入分组配置（非交互终端只输出报表）
- 新增：`grouping.preserveTags`（默认 true），JSDoc 的 `@tags` 保留原始标签，分组名只用于文件与类名
- 优化：分组结果同时输出「方法:路径 → 原始标签」映射，供模板回显
