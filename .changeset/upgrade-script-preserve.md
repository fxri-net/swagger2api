---
"@fxri/swagger2api": patch
---

- 修复：`upgrade` 不再按脚本名识别并删除生成脚本，改为按命令值收敛 `swagger2api` 之后的参数，脚本名、数量与前缀全部保留
- 修复：`upgrade` 不再改写聚合脚本、不再删除 `api:check`，旧版已删除的脚本不会自动恢复
