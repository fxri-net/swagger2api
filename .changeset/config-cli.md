---
"@fxri/swagger2api": minor
---

- 新增：分层配置 `.swagger2apirc.json` / `.swagger2apirc.local.json` / `~/.swagger2apirc.json`，支持段级覆盖与 `FX_S2A_*` 环境变量
- 新增：`swagger2api init` 交互向导与 `--from-script` 脚本迁移，`swagger2api config status` 排障命令
- 新增：`--config` 与 `--profile` 参数；旧命令行参数与 `saconfig.json` 保持兼容
- 优化：`init` 写入受管 `.gitignore` 片段，避免个人配置误入库
