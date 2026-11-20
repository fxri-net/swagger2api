---
"@fxri/swagger2api": patch
---

- 新增：项目层默认配置文件改为 `swagger2api.json`，本地层 `swagger2api.local.json`，全局层 `~/.swagger2api.json`；旧名继续可用
- 新增：同目录新旧配置并存时新名优先并告警，`init` / `grouping` 默认写入新名
- 优化：`init` 的 `.gitignore` 片段新增本地配置忽略项，已有片段按需补齐
