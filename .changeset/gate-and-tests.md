---
"@fxri/swagger2api": patch
---

- 新增：引入 vitest 与 `src/__tests__/`，为 URL 判定与命令行参数解析补首批单元测试，门禁新增「单元测试」步骤
- 优化：`pnpm verify` 本地按改动面跳过无关的安装与文档构建，CI 与 `--full` 恒全量
