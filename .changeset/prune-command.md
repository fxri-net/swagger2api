---
"@fxri/swagger2api": patch
---

- 新增：`swagger2api prune --dir <目录>` 清理废弃产物目录中的生成物，默认只列、`--yes` 才删，手写文件不受影响
- 新增：prune 拒绝仓库根、当前目录祖先、配置目录与软链接目录，`--json` 输出结构化清单供 AI 与 CI 消费
