# CLI 参考

> 本工具的可执行文件名为 `swagger2api`。npx/dlx 执行时必须带作用域全名 `@fxri/swagger2api`——裸写 `npx swagger2api` 会拉取 npm 上同名的其他包；本地安装后可直接使用短名。

## 基本用法

```bash
# 单文档直接生成；多文档进入交互选择
swagger2api

# 多文档：生成指定文档（支持逗号多选）
swagger2api --target base,lc

# 多文档：生成全部文档（非交互环境必须显式给出）
swagger2api --all

# 只校验产物是否与当前配置一致（不写真实目录）
swagger2api --check

# 首次接入：交互生成 swagger2api.json
swagger2api init

# 一键迁移旧配置与脚本
swagger2api upgrade --dry-run

# 输出版本号（纯文本一行）
swagger2api --version
```

## 子命令

```bash
# 默认：生成（无子命令时按最近的 swagger2api.json 执行）
swagger2api [选项]

# 交互式建设配置（写入 swagger2api.json）
swagger2api init

# 迁移旧配置与脚本（兼容别名：init --from-script）
swagger2api upgrade [选项]

# 查看配置分层与生效结果（--json 输出结构化内容）
swagger2api config status

# 查看分组分布并写入分组配置（必须先 --target 指定文档）
swagger2api grouping --target base

# 提取接口面并写基线 / 与基线比对
swagger2api surface --out .swagger2api/surface.json
swagger2api surface --compare .swagger2api/surface.json

# 只读审计产物布局
swagger2api inspect --dir ./src/api/base

# 清理废弃目录中的生成物（默认只列不删，--yes 才执行）
swagger2api prune --dir ./src/api/old

# 输出能力清单 / 包内 AI 技能入口
swagger2api capabilities --json
swagger2api skill
```

### 生成与文档选择

- `--target <id[,id]>`：只生成指定文档，支持逗号多选与重复传参（去重）；未知 id 退出 2。
- `--all`：生成全部文档，不提问；与 `--target` 同时使用退出 2。
- 多文档且终端可交互：默认全不选，空格切换、回车确认；空选退出 0，ESC / Ctrl+C 退出 130。
- 多文档且非交互（含 `--json`）：必须显式 `--target` / `--all`，否则退出 2 并返回 `E_DOC_SELECTION_REQUIRED`。
- `--config <path>`：显式指定项目层配置文件（只替换项目层，全局层与本地层照常叠加）；只接受单个文件。
- `--profile <name>`：选用配置内的命名预设。
- `--check`：生成到临时目录后与现有产物逐文件比对，按「缺失 / 内容不一致 / 多余」三类报出并以稳定结论行收尾；不写真实目录；多文档时逐个校验，任一失败退出 1。
- `--check --json`：输出结构化结果（`schemaVersion`、`toolVersion`、`ok`、`errorCode`、`missing` / `mismatched` / `extra`、`actions`）。
- `--no-interactive`：强制关闭交互提问；需要选择或输入时直接报错并给出等价非交互命令，退出 2。
- 未找到配置文件时直接报错并提示 `swagger2api init`、`upgrade` 或 `--config <文件>`。
- `--modular`：按组拆分为多文件并生成聚合入口。
- `--prune-output`：分组模式默认开启；按生成横幅清理本轮不再生成的旧产物，手写文件不受影响。
- 输出目录安全护栏：分组生成不会在仓库根、配置目录或其祖先目录上执行横幅清理。
- `--timeout <ms>`：覆盖拉取超时（默认 `input.timeout`，未配置为 0 不超时）。
- `--dry-run`：配合分组配置只输出报表（命名映射、未命中规则、桶与分片规划），不写产物。
- `--json`：与 `--dry-run` 组合输出结构化报表；多文档按文档汇总为单个 `{ docs: [...] }`。
- `grouping` 必须 `--target` 指定一个文档；`surface` / `config status` 读取全部文档，`surface` 可用 `--target` 过滤。
- 已移除 `--quick` / `-q`、`--config-all` / `-ca`、`--config-scan` / `-cs`，出现时退出 2 并提示改用 `--target` / `--all`。

## 一键迁移

```bash
# 只输出计划
swagger2api upgrade --dry-run

# 输出计划与行级差异
swagger2api upgrade --diff

# 只读复检旧资产，有残留退出 1
swagger2api upgrade --check

# 非交互执行；--only / --skip 精细控制目录
swagger2api upgrade --yes --only apps/base

# 恢复最近一次备份
swagger2api upgrade --restore latest
```

- 迁移 `saconfig*`、`.swagger2apirc*`、旧版 `defaults` + `targets` 与生成脚本；按配置目录独立处理，不跨目录合并。
- 生成脚本收编为单一 `"api": "swagger2api"`，删除 `api:*` 与 `api:check`；聚合脚本中的 `api:<id>` 引用改为内联 `--target`。
- 写入前备份到 `.swagger2api/backup/<时间>/`；`--restore` 可回退。
- 非 TTY 缺 `--yes` 退出 2；存在未知脚本参数时停止写入并退出 1。

## 接口面基线

```bash
swagger2api surface --out .swagger2api/surface.json
swagger2api surface --compare .swagger2api/surface.json
```

- 从产物目录的 `.ts` / `.d.ts` / `.js` 提取 `@request`、`@name` 与导出类型，排序去重，结构带 `formatVersion`。
- 多文档按文档 `id` 分组；目标集合变化与格式版本不一致都按失败处理。
- `--target <id>` 只提取或比对单个文档；`--requests-only` 只锁接口集合，忽略方法名与类型名。

## 产物布局审计

```bash
swagger2api inspect --dir ./src/api/base
swagger2api inspect --dir ./src/api/base --json
swagger2api inspect --dir ./src/api/base --strict
```

- 只读扫描产物目录；判据取生效配置的 `grouping.split`（未配置用默认阈值），`split: false` 时跳过布局判据。
- 报告每个模块文件的请求数、类数与字节数；分片门面识别为正常。
- 异常项在 `--strict` 下以退出码 1 结束。

## 废弃产物清理

```bash
swagger2api prune --dir ./src/api/old
swagger2api prune --dir ./src/api/old --yes
swagger2api prune --dir ./src/api/old --json
```

- 只删除识别为生成物的文件；手写文件与 `.gitignore` 等非生成物不动；默认只列，必须显式 `--yes` 才删除。
- 拒绝不存在的目录、软链接目录、仓库根、当前目录的祖先与含 `swagger2api*.json` 的配置目录。
- `--json` 输出 `{ schemaVersion, toolVersion, command, ok, errorCode, dir, dryRun, files, actions }`。

## 结构化输出与退出码

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 结构版本，当前 `1` |
| `toolVersion` | 实际使用的工具版本 |
| `command` | `check` / `inspect` / `prune` / `generate` |
| `ok` | 是否通过 |
| `errorCode` | 稳定错误码，成功为 `null` |
| `missing` / `mismatched` / `extra` | `check` 的缺失 / 内容不一致 / 多余三类清单 |
| `files` | `prune` 的生成物清单 |
| `message` | 失败说明（失败时存在） |
| `actions` | 建议的下一步命令 |

- JSON 模式下 stdout 只输出一份 JSON，人类可读日志走 stderr；输出为 UTF-8 无 BOM。
- 错误码：`E_CHECK_FAILED`、`E_LAYOUT_ISSUES`、`E_DIR_NOT_FOUND`、`E_UNSAFE_DIR`、`E_ARGS_MISSING`、`E_DOC_SELECTION_REQUIRED`。

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功：生成完成、校验通过、预览完成或主动空选退出 |
| `1` | 生成或校验失败：拉取失败、产物缺失 / 不一致 / 多余、布局异常（`--strict`）、迁移受阻 |
| `2` | 用法或配置错误：缺少参数、目录不存在、清理目标不安全、需要显式文档选择 |
| `130` | 交互被 ESC / Ctrl+C 取消 |

## 常用组合示例

```bash
# 只更新一个文档
npx @fxri/swagger2api --target base

# 非交互环境更新全部文档
npx @fxri/swagger2api --all

# 移除前缀索引（移除前 1 段路径）
npx @fxri/swagger2api --target base --remove-prefix-index 0

# 替换标签
npx @fxri/swagger2api --replace-tags "user" "userCenter"
```

## swagger-typescript-api 扩展

本工具基于 swagger-typescript-api 封装，`--axios`、`--responses`、`--js` 等原生参数可透传使用，[更多配置选项](https://fig.io/manual/swagger-typescript-api)参考官方文档。

`--single-http-client` 让 `Api` 不再继承 `HttpClient`，改为在构造函数注入共享请求器；其 `http` 与 axios 客户端的 `instance`、安全状态等字段均不可枚举，对象图契约见[指南](./guide)。
