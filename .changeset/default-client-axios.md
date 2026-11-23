---
"@fxri/swagger2api": patch
---

- 修改：默认 HTTP 客户端改为 axios，需要 fetch 时用 `--fetch` 或配置 `client: "fetch"`
- 修改：默认生成响应类型信息（`types.responses`），关闭用 `--no-responses` 或配置 `false`
- 修改：默认把响应体转移到 `raw` 字段（`types.extractResponseRaw`），关闭用 `--no-extract-response-raw` 或配置 `false`
- 优化：写盘剔除三项默认值，`init` / `grouping` / `upgrade` 不再写出 `client: "axios"` 与等同默认值的 `types`
- 文档：同步配置默认值、提取响应的 axios 前提与入门示例结构
