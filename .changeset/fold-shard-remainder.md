---
"@fxri/swagger2api": patch
---

- 修复：分片装箱未复用 `minBucketRoutes`，尾片偏小时并入前一片（不超过 `maxRoutes`），消除碎片分片文件
