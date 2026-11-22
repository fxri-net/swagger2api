# 一键迁移

> `swagger2api upgrade` 把旧配置与生成脚本迁移到新版 `base` + `docs` 结构。先预览、再执行、可回退。

## 迁移什么

- 旧配置文件：`saconfig*.json`、`.swagger2apirc*`（含 `.local`）。
- 旧版 `swagger2api.json`：`defaults` + `targets` 结构、根级 `url` / `file` / `input` / `output`、扁平字段。
- 本地层 `swagger2api.local.json`：按文档 `id` 合并进新结构后保留文件。
- 生成脚本：`api`、`api:*` 合并为单一 `"api": "swagger2api"`；`api:check` 删除；仓库内聚合脚本中的 `api:<id>` 引用改为内联 `--target`。

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
- 迁移后每个配置目录只保留一个 `api` 脚本，文档之间用 `--target` 区分。

## 备份与恢复

- 写入前把 `package.json`、现有配置、本地层与旧配置备份到 `.swagger2api/backup/<时间>/`，附带哈希清单。
- `--restore latest` 恢复备份中的文件，并删除迁移新增的配置文件。
- `.gitignore` 自动补 `.swagger2api/backup/` 与 `swagger2api.local.json`。

## 兼容别名

`swagger2api init --from-script package.json` 等价于以该 `package.json` 所在目录为范围的 `upgrade --yes`；新项目直接用 `swagger2api init` 交互生成配置。

## 相关页面

- 配置字段：[配置参考](./config)
- 命令与参数：[CLI 参考](./cli)
