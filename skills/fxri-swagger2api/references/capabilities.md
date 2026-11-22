# 命令能力清单

> 由 `../SKILL.md` 按需加载。能力 ID 是稳定契约；改命令名时保留 ID 与别名。

| 能力 ID | 命令 | 模式 | 关键参数 | 输出形态 |
| --- | --- | --- | --- | --- |
| `generate` | `swagger2api` | 写入 | `--config` `--target` `--profile` `-q` `--timeout` `--no-interactive` | 接口文件、聚合入口、`client`、`types/`；分组模式默认按横幅清理 |
| `preview` | `swagger2api --dry-run` | 只读 | `--json` | 命名映射、桶 / 分片规划、预计新增文件 |
| `check` | `swagger2api --check` | 只读 | `--json` `--config` `--target` | `missing` / `mismatched` / `extra`，`ok` 与 `errorCode` |
| `init` | `swagger2api init` | 写入 | `--from-script` `--config` | `swagger2api.json`；非终端给等价命令 |
| `grouping` | `swagger2api grouping` | 写入（需终端） | - | `grouping` 配置段；非终端退出码 2 |
| `config-status` | `swagger2api config status` | 只读 | `--json` `--config` `--profile` | 分层命中、环境变量覆盖、生效配置 |
| `surface` | `swagger2api surface` | 写基线 / 只读比对 | `--out` `--compare` `--requests-only` `--json` | 接口与类型清单；比对差异 |
| `inspect` | `swagger2api inspect` | 只读 | `--dir` `--json` `--strict` | 模块体量、`issues` / `hints` |
| `prune` | `swagger2api prune` | 破坏性 | `--dir` `--yes` `--json` | `files` 清单；`--yes` 才删除 |
| `skill` | `swagger2api skill` | 只读 | `--print` `--json` | 入口路径、全文或结构化定位与参考索引 |
| `capabilities` | `swagger2api capabilities` | 只读 | `--json` | 命令、配置项、退出码、技能参考索引 |
| `version` | `swagger2api --version` | 只读 | - | 版本号一行 |

## 逐命令要点

### generate

- 配置驱动时不读 stdin；`-q` 跳过二次确认。`--timeout` 覆盖 `input.timeout`（默认 0 表示不超时）。
- 分组模式（`output.mode: "grouped"`）默认开启 `output.prune`：按文件头横幅清理本轮不再生成的产物。
- 手写文件（不含横幅）不清理；同名冲突会终止生成并保持原文件。

### preview

- 只读：`--dry-run --json` 输出命名、桶、分片与预计新增文件，不落盘。
- 多目标时按目标汇总为 `{ targets: [...] }`。

### check

- 生成到临时目录后与真实产物逐文件比对；真实目录不会被改写。
- JSON 契约：`schemaVersion` / `toolVersion` / `command` / `ok` / `errorCode` / `missing` / `mismatched` / `extra` / `actions`。
- 差异时退出码 1；`actions` 给出可直接复制的下一步（含 `prune` 预览与删除命令）。

### init / grouping

- 都需要交互式终端；非终端（AI / CI）直接以退出码 2 结束并给出等价非交互命令。
- `init --from-script package.json` 从既有 npm script 迁移；无法识别的参数会列出。

### config-status

- 展示全局层 / 项目层 / 本地层命中文件、环境变量覆盖与合并结果；配置疑似不生效时先跑它。

### surface

- `--out` 写基线（建议放 `.swagger2api/surface.json`，默认不提交）；`--compare` 比对增删。
- `--requests-only` 只锁接口集合，适合跨工具版本迁移。

### inspect

- 只读审计，不联网、不依赖配置状态；判据取 `grouping.split`。
- `--strict` 下布局异常退出 1；目录不存在退出 2（`E_DIR_NOT_FOUND`）。

### prune

- 只删识别为生成物的文件（生成横幅，或旧版产物的固定头 + 结构特征）；默认只列，`--yes` 才删。
- 拒绝不存在的目录、软链接目录、仓库根（含 `.git`）、当前目录祖先与含项目配置的目录，退出码 2。

## 退出码

`0` 成功或只读完成；`1` 生成 / 校验失败；`2` 用法或配置错误。
