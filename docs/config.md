# 配置参考

> 每个前端应用目录维护一份 `swagger2api.json`：`base` 写所有文档共享的口径，`docs` 逐项声明输入与输出。运行 `swagger2api` 自动向上查找最近的配置。

## 基本结构

```json
{
  "base": {
    "output": { "name": "index", "mode": "grouped" },
    "client": "axios",
    "language": "ts",
    "types": { "responses": true }
  },
  "docs": [
    { "id": "base", "source": "https://example.com/base/v3/api-docs", "output": "./src/api/base" },
    { "id": "lc", "source": { "file": "./swagger/lc.json", "timeout": 30000 }, "output": { "dir": "./src/api/lc", "name": "lcApi" } }
  ]
}
```

- 根字段只允许 `base`、`docs`、`profiles`；旧版 `url` / `file` / `output` / `defaults` / `targets` 会报错并提示迁移，可用 [`swagger2api upgrade`](./upgrade) 自动转换。
- `docs` 必填非空，每项必须有唯一 `id`；`id` 只允许字母、数字、下划线、短横线，用于 `--target`、日志与本地层覆盖，不参与类名。
- `source` 支持字符串（URL 或本地文件）或对象 `{ "url" | "file", "headers", "timeout" }`；相对路径按配置文件所在目录解析。
- `output` 支持目录字符串或对象；字符串等价于 `{ "dir": "..." }`。`output.name` 只写文件名，不能包含路径分隔符或扩展名。
- 入口文件名优先级：文档项 `output.name` > `base.output.name` > `index`。
- `client` / `language` 支持字符串简写（`axios` / `fetch`、`ts` / `js`），内部会归一为对象。

## 生成与选择

- 单文档：直接生成，不提问。
- 多文档且终端可交互：勾选要生成的文档，默认全不选；空格切换、回车确认。空选退出 0，ESC / Ctrl+C 退出 130。
- 多文档且非交互（含 `--json`）：必须显式给出选择，否则退出 2 并返回 `E_DOC_SELECTION_REQUIRED`。
- `--target <id[,id]>`：只生成指定文档，支持逗号多选与重复传参（自动去重）；未知 id 退出 2。
- `--all`：生成全部文档，不提问。`--target` 与 `--all` 不能同时使用。
- `--check` / `--dry-run` 与生成共用同一选择结果。
- 多文档必须显式选择后才会执行；日常只想更新一个文档时用 `--target`。

## 分层配置

| 层 | 文件 | 用途 |
| --- | --- | --- |
| 项目层 | `swagger2api.json` | 团队共享，随仓库提交 |
| 本地层 | `swagger2api.local.json` | 个人按项目覆盖，默认不入库 |
| 全局层 | `~/.swagger2api.json` | 个人跨项目偏好，只允许 `base` / `profiles` |

- 自工作目录向上查找最近的配置文件；项目层定义 `docs`，本地层按 `id` 覆盖或追加文档项，全局层只提供 `base` / `profiles`。
- 合并优先级：命令行 > 环境变量 > `profiles` > 文档项 > `base`；`base` 深度合并（对象递归、数组整体替换），`docs` 按 id 深度合并。
- 本地层只写差异即可，例如只覆盖某个文档的输出目录，不必复制整份配置。
- 环境变量：`FX_S2A_INPUT`、`FX_S2A_OUTPUT`、`FX_S2A_NAME`、`FX_S2A_CLIENT`、`FX_S2A_LANGUAGE`、`FX_S2A_CLEAN`，按文档生效。
- `profiles`：命名预设深度合并进 `base`，用 `--profile <name>` 选用。
- `swagger2api config status` 只读展示三层命中文件与生效结果，不提问。

## 输出与高级选项

- `output.mode`：`single`（默认）或 `grouped`；分组模式未显式配置 `grouping` 时按路径分组并分桶。
- 产物布局：`grouped` 固定为 `index`（聚合入口）+ 业务模块 + `client`（客户端底座）+ `types/`（契约目录），契约从 `types/index` 导出。
- `output.typeCheck`：`skip`（默认）保留 `// @ts-nocheck`，`enforce` 写盘后剥离，`--check` 按剥离后的产物比对。
- `output.banner`：`zh`（默认）或 `en`；横幅锚点行固定为 ` * ## 文案 ##`，中英结构一致。
- 产物归属靠生成横幅识别：生成物文件头带 `本文件由 @fxri/swagger2api 生成，请勿手改`（英文 `THIS FILE WAS GENERATED VIA @FXRI/SWAGGER2API, DO NOT EDIT`）；`--check` 与清理只读文件头，不依赖持久状态。
- `input.timeout`：拉取远端文档的超时毫秒数，`0`（默认）表示不超时；命令行 `--timeout` 优先。
- `grouping.names` 覆盖模块名；`grouping.collapse` 合并同名组；`grouping.split` 控制自适应分桶（不配置即启用默认阈值，`false` 关闭）。
- 自适应分桶：总量 ≤ `minRoutes`（默认 150）时只生成一个 `Modules` 文件；超过后按命名空间装箱，小桶并入相邻桶，超大命名空间分片并由门面合并实例与类型。
- 保留名（`index`、`types`、`client`、`shared`、`instance`、`request`、`setSecurityData` 等）自动追加序号；契约与模块同名时只改类名与文件名。
- `output.clean` 清空整个输出目录；分组模式默认按横幅清理已消失产物，手写文件不受影响。关闭清理时只报告多余产物。
- 失败回滚：后处理失败时删除本轮新增文件、保留原有产物，修正配置后可直接重跑。
- 同目录只维护一份 `swagger2api.json`；同一配置内文档输出目录不得相同或互相嵌套，违反时退出 2 且不生成任何文档。

## 常用字段

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `docs[].id` | 文档项 | 唯一标识，用于 `--target` 与本地层覆盖 |
| `docs[].source` | 文档项 | URL、本地文件或 `{ url / file, headers, timeout }` |
| `docs[].output` | 文档项 | 目录字符串或 `{ dir, name, mode, ... }` |
| `base.output.name` | 共享段 | 入口文件名默认值，缺省 `index` |
| `base.client` | 共享段 | `axios` / `fetch` |
| `base.language` | 共享段 | `ts` / `js` |
| `base.types` | 共享段 | `responses`、`extractQuery`、`extractResponseRaw` 等 |
| `base.naming` | 共享段 | `pathPrefixIndex`、`convertGetToQuery`、`dropPathParams`、`tagRewrite` |
| `base.grouping` | 共享段 | 分组、命名与分桶配置 |
| `profiles` | 根 | 命名预设，`--profile` 选用 |

命令行参数见 [CLI 参考](./cli)；旧配置迁移见 [一键迁移](./upgrade)。

## 相关页面

- 参考：[CLI 参考](./cli) · [一键迁移](./upgrade) · [完整攻略](./guide) · [常见问题](./faq)
