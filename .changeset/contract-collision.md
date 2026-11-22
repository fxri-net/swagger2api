---
"@fxri/swagger2api": patch
---

- 修复：契约类型名与模块类名同名时只改类名与文件名，避免同一文件内重复声明导致 TS 构建失败，聚合属性保持不变
- 修复：契约与底座（`HttpClient` / `ContentType` / `RequestParams` 等）同名时，根出口显式导出底座，避免 `export *` 歧义把底座名字静默丢弃
- 修改：契约与聚合类 `Api` 同名时以 `ApiContract` 别名导出
