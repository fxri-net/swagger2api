---
"@fxri/swagger2api": patch
---

- 新增：包内技能 `skills/fxri-swagger2api/`，覆盖首次接入、旧配置迁移与产物结构判断
- 新增：`swagger2api skill` / `--print` / `--json` 只读定位技能入口，不写文件、不维护状态
- 优化：`files` 白名单纳入 `skills` 并声明 `agentSkills`，技能随 npm 包发布
