# CLI 参考

> 本工具的可执行文件名为 `swagger2api`。npx/dlx 执行时必须带作用域全名 `@fxri/swagger2api`——裸写 `npx swagger2api` 会拉取 npm 上同名的其他包；本地安装后可直接使用短名。

## 基本用法

```bash
# 读取最近的 swagger2api.json 直接生成
swagger2api

# 多目标配置：无参数执行全部目标，--target 只执行一个
swagger2api --target lc

# 只校验产物是否与当前配置一致（生成到临时目录比对，不写真实目录）
swagger2api --check

# 首次接入：交互生成 swagger2api.json
swagger2api init
```

## 子命令

```bash
# 默认：生成（无子命令时与原用法完全一致）
swagger2api [选项]

# 交互式建设配置（写入 swagger2api.json）
swagger2api init

# 从既有 npm script 迁移参数到配置
swagger2api init --from-script package.json

# 查看配置分层与生效结果（--json 输出结构化内容）
swagger2api config status

# 查看分组分布并写入分组配置（交互式；非交互终端只输出报表）
swagger2api grouping

# 提取接口面并写基线 / 与基线比对
swagger2api surface --out .swagger2api/surface.json
swagger2api surface --compare .swagger2api/surface.json

# 只读审计产物布局（模块体量 / 固定产物 / 小文件）
swagger2api inspect --dir ./src/api/base

# 清理废弃目录中的生成物（默认只列不删，--yes 才执行）
swagger2api prune --dir ./src/api/old

# 输出包内 AI 技能入口（--print 全文，--json 结构化定位）
swagger2api skill
```

- `skill` 只读输出包内技能入口路径、全文或 `{ entry, referencesDir, version }`；不安装、不写文件、不维护状态
- 首次接入、迁移旧配置或调整产物结构时用 `pnpm exec swagger2api skill --print` 激活；日常生成与 `--check` 不需要加载

- `grouping` 向导会预览「原始组名 → 模块名」，并对兜底名、保留名冲突与重名组询问是否改名，结果写入 `grouping.names`；手工名非法或冲突时拒绝写入
- `--config <path>`：显式指定项目层配置文件（只替换项目层，全局层与本地层照常叠加）；存在 `targets` 时只接受单个文件，配置扫描与多选交互关闭
- `--profile <name>`：选用配置文件内的命名预设
- `--target <id>`：多目标配置下只执行指定目标；未知目标或没有 `targets` 的配置以退出码 2 结束
- `--modular`：按组拆分为多文件并生成聚合入口
- `--check`：生成到临时目录后与现有产物逐文件比对，按「缺失 / 内容不一致 / 多余」三类报出并以稳定结论行收尾；多余产物按生成横幅识别；不写真实目录；多目标时逐个校验，任一失败以退出码 1 结束
- `--check --json`：输出结构化结果（`schemaVersion`、`toolVersion`、`ok`、`errorCode`、`missing` / `mismatched` / `extra`、`actions`），便于 AI 与 CI 直接解析
- 配置项 `typeCheck`（`skip` 默认 / `enforce`）：`enforce` 时生成后剥离 `.ts` / `.js` / `.d.ts` 中的 `// @ts-nocheck`，`--check` 按剥离后的产物比对
- `--prune-output`：分组模式默认开启；按生成横幅清理输出目录中本轮不再生成的旧产物，手写文件（不含横幅）不受影响；开关关闭时只报告多余产物、不删除
- 输出目录安全护栏：分组生成不会在仓库根、配置目录或其祖先目录上执行横幅清理，命中时报错并跳过删除
- 同一输出目录只允许一份配置：同目录其他 `swagger2api*.json` / `saconfig*.json` 的输出与本配置相同或互相嵌套时，以退出码 2 拒绝且不落盘
- `--dry-run`：配合分组配置只输出报表——原始组名到文件 / 类 / 属性名的映射、重命名原因、未命中规则、桶与分片规划与预计新增文件，不写产物
- `--json`：与 `--dry-run` 组合时输出结构化报表，便于脚本消费；多目标时按目标汇总为单个 `{ targets: [...] }`

## 接口面基线

```bash
# 写基线（建议放 .swagger2api/surface.json，默认不提交）
swagger2api surface --out .swagger2api/surface.json

# 与基线比对：一致退出 0，有增删退出 1 并列出 +/- 条目
swagger2api surface --compare .swagger2api/surface.json
```

- 从产物目录的 `.ts` / `.d.ts` / `.js` 提取 `@request`、`@name` 与导出类型，排序去重，结构带 `formatVersion`
- 多目标按目标 `id` 分组；目标集合变化（新增 / 缺失）与格式版本不一致都按失败处理
- `--target <id>` 只提取或比对单个目标；`--requests-only` 只锁接口集合，忽略方法名与类型名，适合跨工具版本迁移
- `--json` 输出结构化接口面；`--out` 与 `--compare` 可同时使用（先写再比）

## 产物布局审计

```bash
# 默认输出文本报表
swagger2api inspect --dir ./src/api/base

# 结构化输出，便于脚本消费
swagger2api inspect --dir ./src/api/base --json

# 存在布局异常时以非 0 退出，供 CI 与技能调用
swagger2api inspect --dir ./src/api/base --strict
```

- 只读扫描产物目录，不联网、不依赖配置状态；判据取生效配置的 `grouping.split`（未配置用默认 150 / 300 / 450 / 60），`split: false` 时跳过布局判据
- 报告每个模块文件的请求数、类数与字节数；分片门面（`Object.assign(this, new XxxPartN(http))`）识别为正常，分片余量偏小只提示
- 异常项（小组独立成文件、单文件超过上限、缺少 `index` / `client` / `types`）在 `--strict` 下以退出码 1 结束
- `--config <path>` 显式指定项目层配置，用于阈值覆写的仓库；`--check` 通过后复用同一判据输出「布局审计」提示，不改变既有退出码

## 废弃产物清理

```bash
# 预览：列出目录中带生成横幅的文件，不删除
swagger2api prune --dir ./src/api/old

# 执行删除（只删生成物，手写文件保留）
swagger2api prune --dir ./src/api/old --yes

# 结构化清单，供 AI 与 CI 消费
swagger2api prune --dir ./src/api/old --json
```

- 用于配置已删除的 target、目录搬家后遗留的整个产物目录；当前输出目录内的失效产物由生成时的 `output.prune` 自动处理
- 只删除文件头前 1KB 含生成横幅的文件，手写文件与 `.gitignore` 等非生成物不动；默认 `--dry-run` 语义，必须显式 `--yes` 才删除
- 拒绝不存在的目录、软链接目录、仓库根（含 `.git`）与当前目录的祖先、含项目配置文件的目录，命中时以退出码 2 结束
- `--json` 输出 `{ schemaVersion, toolVersion, command, ok, errorCode, dir, dryRun, files, actions }`，便于脚本按同一契约解析

## 结构化输出与退出码

诊断类命令（`--check`、`inspect`、`prune`）的 `--json` 共用一份契约，AI 决策与 CI 摘要消费同一份输出：

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 结构版本，当前 `1`；遇到更高版本时降级到 `--help` 与静态文档 |
| `toolVersion` | 实际使用的工具版本 |
| `command` | `check` / `inspect` / `prune` / `generate` |
| `ok` | 是否通过 |
| `errorCode` | 稳定错误码，成功为 `null` |
| `missing` / `mismatched` / `extra` | `check` 的缺失 / 内容不一致 / 多余三类清单 |
| `files` | `prune` 的生成物清单 |
| `message` | 失败说明（失败时存在） |
| `actions` | 建议的下一步命令，可直接复制；带 `--yes` 的条目须用户确认后执行 |

- JSON 模式下 stdout 只输出一份 JSON，人类可读日志一律走 stderr；输出为 UTF-8 无 BOM，可直接 `JSON.parse`
- 错误码：`E_CHECK_FAILED`（产物与配置不一致）、`E_LAYOUT_ISSUES`（布局审计异常）、`E_DIR_NOT_FOUND`（目录不存在）、`E_UNSAFE_DIR`（清理目标不安全）、`E_ARGS_MISSING`（缺少必需参数）、`E_CONFIG_CONFLICT`（同目录配置输出重叠）

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功：生成完成、校验通过或预览完成 |
| `1` | 生成或校验失败：拉取失败、产物缺失 / 不一致 / 多余、布局异常（`--strict`） |
| `2` | 用法或配置错误：缺少参数、目录不存在、清理目标不安全、跨配置输出重叠 |

## 配置选项

完整的配置文件字段与命令行参数见[配置参考](./config)。

## 常用组合示例

```bash
# 快速模式，直接使用配置文件参数，不再二次确认参数
npx @fxri/swagger2api --quick

# 填写配置文件路径，支持多选，用【,】分隔，使用该配置后则不会触发配置扫描功能
npx @fxri/swagger2api --config saconfig.json

# 移除前缀索引（移除前 1 段路径）
npx @fxri/swagger2api --remove-prefix-index 0

# 替换标签，2个参数，第1个正则表达式（工具自动补^$头尾，整标签匹配），第2个替换字符串
npx @fxri/swagger2api --replace-tags "user" "userCenter"
```

## swagger-typescript-api 扩展

本工具基于 swagger-typescript-api 封装，`--axios`、`--responses`、`--js` 等原生参数可透传使用，[更多配置选项](https://fig.io/manual/swagger-typescript-api)参考官方文档。
