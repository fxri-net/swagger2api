---
"@fxri/swagger2api": patch
---

- 新增：`grouping.collapse` 合并折叠键相同的组，复现单文件产物「同名属性即同组」的语义
- 修复：组名撞上 `instance`、`request` 等聚合成员时改用追加序号，避免覆盖运行期能力
- 修复：`--replace-tags` 值不足时忽略该参数并告警，不再用空串清空 JSDoc 标签
