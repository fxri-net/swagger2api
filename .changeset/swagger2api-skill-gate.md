---
"@fxri/swagger2api": patch
---

- 新增：`verify` 校验技能打包与定位（`files` / `skill` 命令 / npm 包内容），并调用全局 toolkit `skills lint`
- 优化：toolkit 低于 1.17.6 或不可用时降级为本仓硬断言，并在 stderr 提示安装或升级
- 文档：指南新增「AI 技能：什么时候需要」，README 与 `--help` 露出 `skill` 命令
- 文档：AGENTS 增加本仓库能力自举与规范真源说明
