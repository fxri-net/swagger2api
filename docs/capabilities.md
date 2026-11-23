# 能力总览

> 命令清单以运行时 `swagger2api capabilities --json` 为唯一真源，本页与技能能力地图由验收门禁校验一致。

## 命令

| 能力 ID | 命令 | 模式 | 用途 |
| --- | --- | --- | --- |
| `generate` | `swagger2api` | 写入 | 按配置拉取文档并生成接口产物 |
| `preview` | `swagger2api --dry-run` | 只读 | 只输出分组报表，不写产物 |
| `check` | `swagger2api --check` | 只读 | 校验产物是否与配置一致 |
| `init` | `swagger2api init` | 写入 | 交互生成配置（`--from-script` 为 upgrade 别名） |
| `upgrade` | `swagger2api upgrade` | 写入 | 迁移旧配置到 base + docs，收敛直连脚本参数并保留脚本，支持备份与回退 |
| `grouping` | `swagger2api grouping --target <id>` | 写入（需终端） | 查看指定文档分布并写入分组配置 |
| `config-status` | `swagger2api config status` | 只读 | 配置分层与生效结果 |
| `surface` | `swagger2api surface` | 写基线 / 只读比对 | 提取接口面、写基线或比对增删 |
| `inspect` | `swagger2api inspect` | 只读 | 审计产物布局 |
| `prune` | `swagger2api prune` | 破坏性 | 清理废弃目录中的生成物 |
| `skill` | `swagger2api skill` | 只读 | 定位包内 AI 技能入口 |
| `capabilities` | `swagger2api capabilities` | 只读 | 输出命令、配置项与退出码 |
| `version` | `swagger2api --version` | 只读 | 输出版本号 |

## 结构化输出

`--check --json`、`inspect --json`、`prune --json` 与 `capabilities --json` 共用一份契约：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 结构版本，当前 `1`；更高版本时降级到 `--help` 与本页 |
| `toolVersion` | 工具版本，与 `--version` 一致 |
| `command` | 能力 ID 或命令标识 |
| `ok` | 是否通过 |
| `errorCode` | 稳定错误码，成功为 `null` |
| `missing` / `mismatched` / `extra` | 产物校验的三类清单 |
| `files` | 待清理的生成物清单 |
| `actions` | 建议的下一步命令，可直接复制 |

- JSON 模式 stdout 只有一份 JSON，人类日志走 stderr；UTF-8 无 BOM。
- 错误码：`E_CHECK_FAILED`、`E_LAYOUT_ISSUES`、`E_DIR_NOT_FOUND`、`E_UNSAFE_DIR`、`E_ARGS_MISSING`、`E_DOC_SELECTION_REQUIRED`、`E_SPEC_INVALID`、`E_NO_ENDPOINTS`。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功：生成完成、校验通过或只读完成 |
| `1` | 生成或校验失败 |
| `2` | 用法或配置错误（缺参、目录不存在、目录不安全、多文档未显式选择） |
| `130` | 交互被 ESC / Ctrl+C 取消 |

## 场景入口

| 想做什么 | 从哪开始 |
| --- | --- |
| 第一次接入 | [快速开始](./getting-started) |
| 查命令与参数 | [CLI 参考](./cli) |
| 调配置 | [配置参考](./config) |
| 旧配置 / 旧脚本迁移 | [一键迁移](./upgrade) |
| 产物异常 / 清理 | [CLI 参考 · 废弃产物清理](./cli#废弃产物清理) |
| 让 AI 自助排障 | [能力总览](./capabilities) 与包内技能 `swagger2api skill --print` |
