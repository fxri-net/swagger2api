# CLI 参数

> 由 `../SKILL.md` 按需加载。可执行文件短名 `swagger2api`；npx / dlx 时用全名 `@fxri/swagger2api`。

## 常用命令

```bash
swagger2api                     # 单文档直接生成；多文档交互选择
swagger2api --target lc         # 只生成指定文档（可逗号多选）
swagger2api --all               # 非交互环境生成全部文档
swagger2api --check             # 生成到临时目录并与现有产物比对，不写真实目录
swagger2api init                # 交互生成 swagger2api.json
swagger2api upgrade --dry-run   # 预览旧配置 / 旧脚本迁移
swagger2api grouping --target base # 查看指定文档分组分布并写入配置
swagger2api config status       # 查看配置分层与生效结果
swagger2api surface --out .swagger2api/surface.json   # 写接口面基线
swagger2api surface --compare .swagger2api/surface.json # 与基线比对接口与类型增删
swagger2api inspect --dir ./src/api/base   # 只读审计产物布局（模块体量 / 固定产物 / 小文件）
swagger2api prune --dir ./src/api/old      # 清理废弃目录中的生成物（默认只列，--yes 才删）
swagger2api --version           # 输出版本号（纯文本一行）
swagger2api skill               # 输出包内技能入口绝对路径
swagger2api skill --print       # 输出技能入口全文
swagger2api skill --json        # 输出入口、references 目录与技能版本
```

## 生成相关开关

| 参数 | 作用 |
| --- | --- |
| `--modular` | 按组拆分为多文件并生成聚合入口 |
| `--dry-run` | 只输出报表，不写产物；分组模式给出命名、桶 / 分片规划与预计新增文件 |
| `--json` | 与 `--dry-run` 组合输出结构化报表；与 `--check` 组合输出结构化校验结果（`schemaVersion`、`toolVersion`、`missing` / `mismatched` / `extra`） |
| `--prune-output` | 按生成横幅清理本轮不再生成的产物，不触碰手写文件；关闭时只报告不删除 |
| `--config <path>` | 显式指定项目层配置（只接受单个文件） |
| `--target <id[,id]>` | 只生成指定文档；逗号多选、重复去重，未知 id 退出码 2 |
| `--all` | 生成全部文档；与 `--target` 同现退出码 2 |
| `--profile <name>` | 选用配置内的命名预设 |
| `--no-interactive` | 关闭交互提问；多文档必须显式 `--target` / `--all`，否则退出码 2 |
| `--timeout <ms>` | 覆盖拉取超时（`input.timeout`，默认 0 不超时）；超时与网络错误转为可读提示，退出码 1 |
| `--version` | 输出版本号纯文本一行，与诊断 JSON 的 `toolVersion` 一致 |

- `--quick` / `-q`、`--config-all`、`--config-scan` 已移除，出现时退出码 2。
- 多文档 TTY 勾选默认全不选；空选退出 0，ESC / Ctrl+C 退出 130。
- `upgrade` 支持 `--dry-run` / `--diff` / `--check` / `--yes` / `--only` / `--skip` / `--cwd` / `--json` / `--keep-legacy` / `--restore`。

## 诊断 JSON 与退出码

`--check --json`、`inspect --json`、`prune --json` 共用一份契约：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 结构版本，当前 `1`；更高版本时降级到 `--help` 与本文件 |
| `toolVersion` | 工具版本 |
| `command` | `check` / `inspect` / `prune` / `generate` |
| `ok` | 是否通过 |
| `errorCode` | `E_CHECK_FAILED` / `E_LAYOUT_ISSUES` / `E_DIR_NOT_FOUND` / `E_UNSAFE_DIR` / `E_ARGS_MISSING` / `E_DOC_SELECTION_REQUIRED` / `E_SPEC_INVALID` / `E_NO_ENDPOINTS`，成功为 `null` |
| `missing` / `mismatched` / `extra` | check 的三类清单 |
| `files` | prune 的生成物清单 |
| `actions` | 建议的下一步命令，可直接复制；带 `--yes` 的须用户确认 |

- JSON 模式下 stdout 只有一份 JSON，人类日志在 stderr，可直接 `JSON.parse`
- 退出码：`0` 通过 / 预览完成 / 主动空选；`1` 生成、校验或迁移失败；`2` 参数或配置错误（缺参、目录不存在、目录不安全、多文档未显式选择）；`130` 交互取消
- AI 与 CI 一律显式传 `--config <文件>` 与 `--target` / `--all`，不要依赖交互选择；`init`、`grouping` 在非终端环境以退出码 2 结束并给出等价命令

## 使用顺序

1. 改配置后先 `--dry-run --json`，重点看命名映射、桶与分片规划、预计新增文件。
2. 确认后生成；产物结构有变化时先确认旧产物会按横幅清理（分组默认开启，单文件模式只告警）。
3. 最后用 `--check` 验收（可加 `--json`），不要在 `--check` 模式下期待写盘。
4. 离线产物或手改产物用 `swagger2api inspect --dir <目录>` 校验布局：小组并桶、分片余量与固定产物；`--strict` 可让异常直接失败。
5. 配置删掉文档或目录搬家后，用 `swagger2api prune --dir <目录>` 收尾：默认只列带生成横幅的文件，确认后加 `--yes`；不要用 `--clean-output` 清理混放手写文件的目录。
6. 旧配置与脚本先 `swagger2api upgrade --dry-run`，确认后 `--yes`；需要回退时 `--restore latest`。

完整参数与边界见仓库 `docs/cli.md`。
