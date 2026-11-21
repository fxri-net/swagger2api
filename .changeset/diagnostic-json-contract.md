---
"@fxri/swagger2api": patch
---

- 修改：`--check` / `inspect` / `prune` 的 `--json` 统一带 `schemaVersion`、`toolVersion`、`command`、`ok`、`errorCode` 与 `actions`
- 修改：JSON 模式下人类日志改走 stderr，stdout 只输出一份可直接解析的 JSON
- 新增：跨配置输出重叠在 JSON 模式下返回 `E_CONFIG_CONFLICT` 与可执行的下一步命令
- 文档：技能新增排障手册（症状 → 命令）与退出码表，明确生成后必须跑 `--check`
