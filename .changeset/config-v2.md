---
"@fxri/swagger2api": minor
---

- 新增：项目配置改为 `base` 共享段 + `docs` 文档列表，文档项用 `source` 声明 URL / 本地文件与 headers、timeout
- 新增：`base.output.name` 作为入口文件名默认值，优先级为文档项 > `base.output.name` > `index`；`client` / `language` 支持字符串简写
- 修改：删除 `saconfig*`、`.swagger2apirc*`、`--config-scan`、`--config-all` 与逗号多文件 `--config`，只保留单个 `--config`
- 修改：`grouping` / `surface` 必须用 `--target` 指定文档，`config status` 不再提问
