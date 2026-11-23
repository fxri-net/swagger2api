# 一键迁移

> `swagger2api upgrade` 把旧配置与生成脚本迁移到新版 `base` + `docs` 结构。先预览、再执行、可回退。

## 迁移什么

- 旧配置文件：`saconfig*.json`、`.swagger2apirc*`（含 `.local`）。
- 旧版 `swagger2api.json`：`defaults` + `targets` 结构、根级 `url` / `file` / `input` / `output`、扁平字段。
- 本地层 `swagger2api.local.json`：按文档 `id` 合并进新结构后保留文件。
- 生成脚本：只按命令值识别，凡命令是直连 `swagger2api` 调用（可带 `npx`、`pnpm exec` 或可执行文件路径前缀）的脚本，都把 `swagger2api` 之后的个性化参数收敛进配置，脚本键名与命令前缀原样保留；迁移不新增、不删除、不重命名任何脚本。
- 跳过非生成用法：带 `--check` 的检查脚本、`grouping` / `inspect` / `prune` / `surface` / `config` / `skill` / `init` 等子命令、`--version` / `--help`，以及复合命令（`&&`、`||`、`;`、管道、后台 `&`）、含环境变量赋值或位置参数的脚本一律不动。

按配置目录逐个处理，不同目录的配置不会合并。全局层 `~/.swagger2api.json` 的旧结构只报告人工项，不自动修改 home。

## 安全流程

```bash
# 1. 只输出计划
swagger2api upgrade --dry-run

# 2. 查看行级差异
swagger2api upgrade --diff

# 3. 只读复检旧资产（有残留退出 1）
swagger2api upgrade --check

# 4. 非交互执行
swagger2api upgrade --yes

# 5. 需要时回退最近一次备份
swagger2api upgrade --restore latest
```

- `--only <目录>` / `--skip <目录>`：按配置目录相对路径精细控制。
- `--cwd <目录>`：限定扫描根。
- `--json`：输出结构化计划，便于脚本消费。
- `--keep-legacy`：保留旧配置文件（默认成功后删除）。
- 非 TTY 缺少 `--yes` 时退出 2；交互取消退出 130。

## 结构映射

| 旧写法 | 新写法 |
| --- | --- |
| `defaults` | `base` |
| `targets` | `docs` |
| 文档项 `input` / `url` / `file` | 文档项 `source` |
| 根级 `output` / `name` | `base.output` 或对应文档项 `output` |
| `client: { type: "axios" }` | `client: "axios"` |
| `language: { target: "js" }` | `language: "js"` |
| `--name <name>` | 对应文档项 `output.name` |
| `--quick` | 丢弃（新版无需输入向导） |

- 多个旧配置会各生成一个文档项，`id` 从文件名或输出目录推导；输出目录相同或互相嵌套时停止自动迁移并要求人工处理。
- 同一文档的文件配置与脚本参数冲突时，脚本参数优先并提示。
- 未知脚本参数不猜测：该项停止自动迁移并以退出码 1 结束，修正后重跑。
- 脚本目标文档按以下顺序唯一确定：`--config <旧配置>` 指向的已迁移文件 → `--target <id>` → `--url` / `--output` / `--name` 与文档唯一匹配 → 该目录只有一个文档；仍无法唯一确定时保留原脚本并列为人工项，不猜测。
- 重写脚本只替换 `swagger2api` 之后的参数：保留 `npx` / `pnpm exec` / 路径前缀，保留 `--profile`、`--all` 等工具级参数；单文档改写为 `swagger2api`，多文档改写为 `swagger2api --target <id>`。
- `--check` 只报「旧配置文件仍存在」与「直连脚本仍带配置类参数」；`api:*` 引用、聚合脚本与检查脚本不算遗留。
- 旧版本迁移时删除过的脚本不会自动恢复：需要时从版本库或备份手工补回，重新执行迁移只保留当前存在的脚本。
- 迁移写盘遵循「只写个性化配置」：等于默认值的字段不落盘，`docs` 中与 `base` 相同的配置上提到 `base`，短文档项保持单行。上表的 `client` / `language` 只描述写法归一；若取值等于默认值（如 `client: "axios"`），迁移后不会写出。

## 备份与恢复

- 写入前把 `package.json`、现有配置、本地层与旧配置备份到 `.swagger2api/backup/<时间>/`，附带哈希清单。
- `--restore latest` 恢复备份中的文件，并删除迁移新增的配置文件。
- `.gitignore` 自动补 `.swagger2api/backup/` 与 `swagger2api.local.json`。

## 兼容别名

`swagger2api init --from-script package.json` 等价于以该 `package.json` 所在目录为范围的 `upgrade --yes`；新项目直接用 `swagger2api init` 交互生成配置。

## 相关页面

- 配置字段：[配置参考](./config)
- 命令与参数：[CLI 参考](./cli)
