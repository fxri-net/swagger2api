---
"@fxri/swagger2api": patch
---

- 修复：分组产物的聚合入口补齐 `AxiosResponse`、`FullRequestParams`、`RequestParams`、`ContentType`、`HttpClient` 导出，包桶引用与单文件产物一致
- 修复：JS 模式分组模块声明补齐 `AxiosResponse` 导入，`AxiosParse` 推导不再退化为 `unknown`
- 修复：分组模块改为注入聚合请求器，替换 `api.instance` 与 `setSecurityData` 会对所有组同时生效
