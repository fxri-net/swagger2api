---
"@fxri/swagger2api": patch
---

- 修复：`client: "fetch"` 与默认（未传 `--axios`）未生效，产物仍输出 Axios 客户端；`http-client` 模板改为按客户端类型分发，fetch 走上游 fetch 实现
- 修复：fetch 模式下分组模块与分片门面不再暴露 Axios 专属的 `instance` 访问器
- 新增：产物一致性门禁补 fetch 实现断言（分组 fetch 与单文件 fetch 均不得引入 axios）
