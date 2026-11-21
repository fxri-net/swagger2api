---
"@fxri/swagger2api": patch
---

- 新增：`input.timeout`（默认 30000 毫秒）与 `--timeout` 覆盖，超时与网络错误转为可读提示并提示重试或改用本地快照，退出码 1
- 新增：`swagger2api --version` 输出版本号（纯文本一行），诊断 JSON 的 `toolVersion` 与之一致
- 修改：`grouping` 的文档拉取同样受超时约束，非法超时值告警后回落默认
