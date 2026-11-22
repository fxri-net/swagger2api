---
"@fxri/swagger2api": patch
---

- 修改：模块与分片门面的 `http` 声明改为 `readonly`，与运行期不可写保持一致，业务侧赋值会在类型检查阶段暴露
