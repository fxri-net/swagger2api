---
"@fxri/swagger2api": patch
---

- 新增：`--no-interactive` 与终端判定，需要交互时在非 TTY 环境直接以退出码 2 结束并给出等价非交互命令
- 修改：`init`、`grouping` 在非终端环境改为报错退出 2，不读取 stdin、不猜测配置
- 修改：未找到配置文件时提示 `swagger2api init` 或 `--config <文件>`，不再隐式进入交互向导
- 文档：技能明确 AI / CI 一律显式传 `--config`
