---
"@fxri/swagger2api": patch
---

- 修改：分组产物底座改名，`http-client` 改为 `client`，`data-contracts` 改为 `types/` 目录
- 新增：契约出口固定为 `types/index`，聚合入口按 `export * from "./types"` 导出
- 新增：旧版 `data-contracts` / `http-client` 残留会在生成成功后自动清理
- 优化：产物清单、按清单清理与手写护栏支持 `types/` 嵌套路径
