---
"@fxri/swagger2api": patch
---

- 新增：`swagger2api capabilities --json` 输出命令、配置项、退出码与技能参考索引，能力 ID 作为稳定契约
- 新增：`swagger2api skill --json` 补 references 索引，供 AI 按需加载
- 修改：技能重构为能力地图（场景 → 命令 → 输出 → 下一步），新增 `capabilities.md` / `recipes.md` 参考
- 新增：验收门禁校验注册表与 `--help`、技能能力地图、docs 能力总览、README 命令表一致
- 文档：新增能力总览页并接入站点导航
