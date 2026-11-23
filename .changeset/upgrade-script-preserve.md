---
"@fxri/swagger2api": patch
---

- 修复：`upgrade` 不再按脚本名识别并删除生成脚本，改为按命令值收敛 `swagger2api` 之后的参数，脚本名、数量与前缀全部保留
- 修复：`upgrade` 不再改写聚合脚本、不再删除 `api:check`，旧版已删除的脚本不会自动恢复
- 文档：README 与 `docs/` 同步「只收敛参数、保留脚本」口径，技能 `references/migration.md` 同步并递增至 1.3.4
