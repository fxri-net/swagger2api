---
name: fxri-swagger2api
description: 使用或排障 @fxri/swagger2api 时加载：生成接口产物、校验产物一致性、清理旧产物、首次接入或迁移配置、审计产物布局、记录接口面基线、配置与权限排障。给出能力地图（场景 → 命令 → 输出 → 下一步）、最小配置与非交互用法。不用于一般 TypeScript / axios 用法或接口文档写作。
license: MIT
metadata:
  version: "1.2.4"
  tier: optional
  author: fxri
  source: https://github.com/fxri-net/swagger2api
---

# swagger2api

> 本技能版本 1.2.4（随 @fxri/swagger2api 分发）。被问版本时即报此值（不读磁盘、不跑 CLI）；与已安装依赖的技能版本不一致即说明会话上下文已过期，开新会话即可。

一句话：把 Swagger 文档转成可提交的 TS / JS 接口产物，并负责校验、审计与清理同源产物。

## 能力边界

- 能做：生成（单文件 / 分组）、产物校验、布局审计、废弃目录清理、接口面基线、配置分层排障、旧用法迁移。
- 不做：手改生成物、业务代码改造、接口文档写作、清理非本工具产物（只认生成横幅）。
- 运行时自描述：`swagger2api capabilities --json` 输出命令、配置项、退出码与参考索引；遇到未知的更高 `schemaVersion` 时降级到 `--help` 与本技能静态地图。

## 能力地图

| 场景 | 命令（能力 ID） | 产出 / 输出 | 模式 | 下一步 |
| --- | --- | --- | --- | --- |
| 按配置生成接口产物 | `swagger2api`（`generate`） | 接口文件 / 聚合入口 / types | 写入 | `check` |
| 只看分组规划 | `swagger2api --dry-run --json`（`preview`） | 命名、桶、分片与预计新增文件 | 只读 | `generate` |
| 提交前校验产物 | `swagger2api --check --json`（`check`） | missing / mismatched / extra | 只读 | `prune` 或重新生成 |
| 清理废弃目录 | `swagger2api prune --dir <目录> --json`（`prune`） | files 清单；`--yes` 才删 | 破坏性 | `check` |
| 审计产物布局 | `swagger2api inspect --dir <目录> --json`（`inspect`） | issues / hints / 模块体量 | 只读 | `preview` |
| 首次接入或迁移 | `swagger2api init`（`init`），`--from-script` | `swagger2api.json` | 写入 | `generate` |
| 分组向导 | `swagger2api grouping`（`grouping`） | `grouping` 配置段 | 写入（需终端） | `preview` |
| 配置与权限排障 | `swagger2api config status --json`（`config-status`） | 分层、环境变量、生效值 | 只读 | `generate` |
| 接口面基线 | `swagger2api surface --out / --compare`（`surface`） | 接口与类型清单 | 写基线 / 只读比对 | `check` |
| 能力自描述 | `swagger2api capabilities --json`（`capabilities`） | 命令 / 配置 / 退出码 | 只读 | `generate` |
| 技能定位 | `swagger2api skill --json`（`skill`） | 入口、版本、参考索引 | 只读 | `capabilities` |
| 版本记录 | `swagger2api --version`（`version`） | 版本号一行 | 只读 | `capabilities` |

### 不要用

- 不要用 `output.clean` 清理混放手写文件的目录；用 `prune --dir` 只删生成物。
- 不要手改生成物或复用生成横幅；需要去掉 `@ts-nocheck` 时用 `typeCheck: "enforce"`。
- 不要在同一输出目录放两份配置；冲突会以退出码 2 拒绝且不落盘。
- 不要在 AI / CI 里依赖交互提问：显式传 `--config`，非终端会直接报错退出 2。

## 三步上手

1. **生成**：写最小 `swagger2api.json`（`input` / `output` / `client`），执行 `swagger2api --config swagger2api.json`；产物结构要变时先 `--dry-run --json`。
2. **校验**：生成后必须跑 `swagger2api --check --json`，要求 `ok: true`；失败不改产物，按 `actions` 处理。
3. **清理**：产物多余或目录废弃时先 `prune --json` 预览，经用户确认后加 `--yes`。

## 参考（按需加载）

- 逐命令说明：`references/capabilities.md`
- CLI 参数、诊断 JSON 契约与退出码：`references/cli.md`
- 配置决策项、多目标与分层：`references/config.md`
- 产物结构、横幅归属与验收：`references/output.md`
- 症状 → 命令排障：`references/troubleshooting.md`
- 首次接入 / 多目标 / 离线迁移 / CI 接入配方：`references/recipes.md`
- 旧脚本与旧配置迁移：`references/migration.md`

## 安全约束

- 手写文件不含生成横幅，不会被清理；同名冲突会终止生成并提示。
- 破坏性命令默认只列：`prune` 必须用户确认后才加 `--yes`，AI 不自行追加。
- 输出目录为仓库根、配置目录或其祖先时拒绝清理。
- 配置与示例不写本机绝对路径、令牌或私网地址。
