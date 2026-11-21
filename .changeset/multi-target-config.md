---
"@fxri/swagger2api": patch
---

- 修复：支持 `defaults` + `targets` 多目标配置，一条命令生成或校验全部目标，`--target <id>` 只执行指定目标
- 修复：多目标生成前整体预校验 `id`、输入与输出目录，冲突时以退出码 2 结束且不写任何目标
