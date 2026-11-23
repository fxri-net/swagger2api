---
"@fxri/swagger2api": patch
---

- 修复：`output.clean: true` 在空输出目录下会删掉预建的契约目录，导致分组生成以 `types/index` 缺失失败
