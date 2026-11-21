---
name: fxri-swagger2api
description: 首次为项目初始化 swagger2api 配置、迁移旧脚本配置或调整产物结构时加载：给出最小配置、先预览再落盘、说明分组产物与验收方式。日常生成、--check 与验收不加载。不用于一般 TypeScript / axios 用法或接口文档编写。
license: MIT
metadata:
  version: "1.1.7"
  tier: optional
  author: fxri
  source: https://github.com/fxri-net/swagger2api
---

# swagger2api 接入

> 本技能版本 1.1.7（随 @fxri/swagger2api 分发）。被问版本时即报此值（不读磁盘、不跑 CLI）；与已安装依赖的技能版本不一致即说明会话上下文已过期，开新会话即可。

## 何时使用

- **首次给项目接入**：还没有 `swagger2api.json`，需要定最小配置并生成第一版产物。
- **迁移旧用法**：从 npm script 或旧的 `saconfig.json` 迁到分层配置，需要判断哪些参数仍适用。
- **调整产物结构**：从单文件切到分组、改客户端或语言、调整命名与契约拆分。

不适用：日常生成、`--check`、CI 验收——这些直接跑既有脚本，不要为一次生成加载本技能。
也不用于一般 TypeScript / axios 用法或接口文档写作。

## 工作流

1. **先判断是否真的需要**：只有配置形态要变时才读本技能；日常生成按项目里的既有命令执行即可。
2. **定最小配置**：只写 `input`、`output`、`client`，其余按默认；需要分组、JS、响应类型或 query 提取时再逐项加。
   决策项与默认值见 `references/config.md`。
3. **写入项目层**：配置落到仓库根 `swagger2api.json`（随仓库提交）；个人差异写本地层，不入库。
4. **先预览再落盘**：分组模式加 `--dry-run --json`，确认命名映射、桶与分片规划、预计新增文件；
   单文件模式可先 `--dry-run` 看报表。发现拆法不符合预期时改分组规则，不要生成后再手改。
5. **生成**：用项目既有脚本或 `swagger2api`（本地安装后）执行；首次生成后确认产物目录与配置一致。
6. **验收**：跑 `swagger2api --check` 确认产物与配置一致；再跑项目类型检查。产物结构与验收口径见 `references/output.md`。
7. **记录边界**：生成物默认沿用 `// @ts-nocheck`，类型错误不进入下游检查；需要类型检查接管时配置 `typeCheck: "enforce"`，由工具统一剥离，不要手改生成物。

## 不做

- 不手改生成物；需要去掉 `@ts-nocheck` 时用 `typeCheck: "enforce"` 由工具剥离，不要手删后提交。
- 不在日常生成、`--check` 或验收时加载本技能，避免把低频能力写成常驻流程。
- 不猜分桶 / 分片阈值：阈值属于工具默认，业务配置只决定分组策略与命名。
- 不把本机绝对路径、令牌或私网地址写进配置与示例。
- 不在未预览的情况下直接切换 `mode`，尤其是已有产物需要清理或迁移时。

## 参考

- 配置决策：`references/config.md`
- CLI 参数与常用组合：`references/cli.md`
- 产物结构与验收：`references/output.md`
- 旧用法迁移：`references/migration.md`
- 定位本技能：`swagger2api skill`（入口路径）/ `swagger2api skill --print`（入口全文）/ `swagger2api skill --json`（结构化定位）
