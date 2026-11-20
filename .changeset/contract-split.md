---
"@fxri/swagger2api": patch
---

- 新增：契约按业务文件拆分，单归属进 `types/<业务文件>.ts`，多归属与未使用进 `types/shared.ts`
- 新增：`types/index` 改为显式导出 barrel，内部声明只在本文件导出、不进入公开面
- 优化：JS 模式的运行时枚举随归属文件落盘，出口同步 re-export
- 优化：`typescript` 提升为运行时依赖，用于按声明解析契约引用
