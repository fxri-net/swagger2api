---
"@fxri/swagger2api": minor
---

- 新增：分组输出，`output.mode = grouped`（或 `--modular`）时按组拆分多文件并补写聚合入口
- 新增：`grouping` 配置支持 rules / tag / path 三种策略与 minRoutes、maxRoutes 阈值，`--dry-run` 输出分组报表
- 修复：模块化模式下每个模块文件重复渲染全部接口的问题（模板改为按 `route.routes` 渲染）
- 优化：聚合入口按组挂载模块实例并共享同一个请求实例，调用形态保持 `api.<组>.<方法>`
