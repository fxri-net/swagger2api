---
"@fxri/swagger2api": minor
---

- 新增：多文档配置默认交互选择要生成的文档，单文档直接生成；`--all` 全选，`--target` 支持逗号多选与重复传参
- 修改：非交互环境多文档必须显式 `--target` / `--all`，否则退出 2 并返回 `E_DOC_SELECTION_REQUIRED`
- 修改：交互空选退出 0，ESC / Ctrl+C 退出 130 且不打印堆栈
- 优化：交互统一改用 `@inquirer/prompts`，移除 `prompts` 依赖与已无意义的 `--quick` / `-q`
