---
"@fxri/swagger2api": patch
---

- 优化：`pnpm verify` 新增分组产物一致性检查（axios / fetch 各生成一次，断言不串组且可解析）
- 优化：Windows 与 GitLab CI 补 node18 运行时作业，覆盖平台 × 运行时下限组合
- 新增：`swagger2api grouping` 支持规则编辑，按「匹配方式 + 匹配值 + 组名」逐条写入配置
- 文档：README、快速开始、首页与 FAQ 更新推荐用法（init → 生成 → grouping）与分组入口
