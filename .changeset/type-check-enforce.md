---
"@fxri/swagger2api": patch
---

- 修复：新增 `typeCheck`（扁平）/ `output.typeCheck`（嵌套）配置，`enforce` 时在写盘后剥离 `.ts` / `.js` / `.d.ts` 中的 `// @ts-nocheck`
- 修复：`--check` 的临时产物走同一剥离处理后再比对，避免与真实产物误报不一致
