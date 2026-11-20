---
"@fxri/swagger2api": patch
---

- 新增：`output.prune`（`--prune-output`）按上一轮生成清单清理已消失的模块，不触碰手写文件与清单外产物
- 新增：分组产出后写 `.swagger2api.manifest.json`，记录本轮文件清单与工具版本
- 修复：目标模块名已被手写文件占用时终止生成并提示，不再静默覆盖
- 修复：临时文档改落系统临时目录，`output.clean` 与收尾清理不再报 ENOENT
