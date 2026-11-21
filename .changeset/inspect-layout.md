---
"@fxri/swagger2api": patch
---

- 新增：`inspect --dir` 只读审计产物布局，报告模块体量、分片门面与固定产物缺失，`--strict` 下异常非 0 退出
- 修改：`--check` 通过后按同一判据输出布局审计提示，不改变既有退出码
