# Swagger 转 API

## 1.4.2

> 2026-11-23 发布

### ⚡ 优化改进

- 本仓文档与脚本里的 toolkit 旧命令名改为现行口径（`task` / `skill` / `release`），不再触发弃用告警

## 1.4.1

> 2026-11-23 发布

### ✨ 新增功能

- 本仓本地验证脚本 `scripts/product-contrast.mjs`，同一份 swagger 快照分别用旧版与当前 CLI 生成并比对导出契约与业务调用点
- 比对脚本的 `--snapshot` 阶段，从配置 `source` 拉取快照（含凭据地址由 axios 转 Basic，日志只输出脱敏地址），生成前校验快照齐备，报告记录快照字节数与 sha256 指纹

### 🔧 功能调整

- 默认 HTTP 客户端改为 axios，需要 fetch 时用 `--fetch` 或配置 `client: "fetch"`
- 默认生成响应类型信息（`types.responses`），关闭用 `--no-responses` 或配置 `false`
- 默认把响应体转移到 `raw` 字段（`types.extractResponseRaw`），关闭用 `--no-extract-response-raw` 或配置 `false`

### ⚡ 优化改进

- `init` / `grouping` / `upgrade` 写盘省略等于默认值的字段，短对象保持单行（阈值 160 字符）

### 🐛 问题修复

- `output.clean: true` 在空输出目录下会删掉预建的契约目录，导致分组生成以 `types/index` 缺失失败
- 根出口同名别名按契约 barrel 的真实导出名判定，避免注释或类型名片段触发误判导致 `TS2305`
- 分片门面同名成员分散在不同分片时接口重复继承（TS2320），改按运行时覆盖顺序用 `Omit` 合并
- `upgrade` 不再按脚本名识别并删除生成脚本，改为按命令值收敛 `swagger2api` 之后的参数，脚本名、数量与前缀全部保留
- `upgrade` 不再改写聚合脚本、不再删除 `api:check`，旧版已删除的脚本不会自动恢复

### 📝 文档更新

- 补充「只写个性化配置」口径（配置参考 / CLI / 一键迁移 / 技能）
- 同步配置默认值、提取响应的 axios 前提与入门示例结构
- 补齐错误码清单中的 `E_SPEC_INVALID` / `E_NO_ENDPOINTS`（CLI 与能力总览），并补充 `base.output.prune` 配置键说明
- 技能错误码清单移除已废弃的 `E_CONFIG_CONFLICT`，补齐 `E_DOC_SELECTION_REQUIRED`
- 迁移说明补充取值等于默认值的 `client` / `language` 迁移后不会写出
- README / AGENTS 补充脚本用法，FAQ 补充升级前接口面比对方法
- README 与 `docs/` 同步「只收敛参数、保留脚本」口径，技能 `references/migration.md` 同步并递增至 1.3.4

## 1.4.0

> 2026-11-23 发布

### 🚨 重大变更

- 配置文件改为 `base` + `docs` 结构：删除 `saconfig*` / `.swagger2apirc*` 读取、`--config-scan` / `--config-all` 与逗号多文件 `--config`，旧配置需用 `swagger2api upgrade` 迁移
- 移除 `--quick` / `-q`；生成脚本统一为单一 `api`，`api:*` 与 `api:check` 需改用 `swagger2api --target <id>`
- `grouping` 与 `surface` 必须用 `--target` 指定文档；多文档在非交互环境必须显式 `--target` / `--all`，否则退出 2 并返回 `E_DOC_SELECTION_REQUIRED`
- 产物横幅只识别当前中英锚点：升级后首次生成前需清空产物目录，否则旧产物会被手写护栏拦下

### ✨ 新增功能

- 项目配置支持 `base` 共享段 + `docs` 文档列表，文档项用 `source` 声明 URL / 本地文件与 headers、timeout
- `base.output.name` 作为入口文件名默认值（优先级：文档项 > `base.output.name` > `index`）；`client` / `language` 支持字符串简写
- 多文档默认交互选择要生成的文档，`--all` 全选，`--target` 支持逗号多选与重复传参
- `swagger2api upgrade` 一键迁移旧配置与生成脚本，支持 `--dry-run` / `--diff` / `--check` / `--yes` / `--only` / `--skip` / `--cwd` / `--json` / `--keep-legacy` / `--restore`
- `output.banner`（`zh` 默认 / `en`）控制产物文件头横幅语言，非法值告警后回落中文
- 新增 `docs/upgrade.md` 迁移指南并接入文档站导航

### 🔧 功能调整

- 产物横幅统一为同一套结构，中文与英文仅文案不同，来源只标识 `@fxri/swagger2api`；锚点行不填充对齐空格
- 生成物对象图契约收敛为「可枚举自有属性只允许方法 / 叶子数据」：`--single-http-client` 的 `http` 与 `HttpClient` 的 `instance` / `securityData` / `securityWorker` / `secure` / `format` 一律不可枚举
- 模块与分片门面的 `http` 声明改为 `readonly`，与运行期不可写一致
- 远端文档拉取默认不设超时（`input.timeout` 默认 `0`），请求能建立即按「慢」处理；`0` 为合法取值，负数与非数字告警后回落默认
- 能力清单更新命令、参数、配置键与退出码，移除 `--quick` / `targets` 旧描述
- 写入前备份到 `.swagger2api/backup/<时间>/`，`--restore latest` 可回退；`init --from-script` 转为 `upgrade --yes` 别名
- 交互空选退出 0，ESC / Ctrl+C 退出 130 且不打印堆栈
- `grouping.names` 手工名命中聚合成员时直接报错，不再静默生成坏产物

### ⚡ 优化改进

- 交互统一改用 `@inquirer/prompts`，移除 `prompts` 依赖

### 🐛 问题修复

- 契约类型名与模块类名同名时只改类名与文件名，避免同一文件内重复声明导致 TS 构建失败；契约与 `HttpClient` 等底座同名时根出口显式导出底座，与聚合类 `Api` 同名时以 `ApiContract` 别名导出
- `client: "fetch"` 与默认（未传 `--axios`）未生效，产物仍输出 Axios 客户端：模板改为按客户端类型分发，fetch 模式不再暴露 Axios 专属 `instance`
- TS 分组产物的模块与 route-types 只对运行时枚举按值导入，纯类型写 `import type`；`RequestParams` 改为类型导入，避免 `verbatimModuleSyntax` 项目启动即报缺失导出；JS 产物的声明文件保持值导入形态
- 后处理失败会残留不完整产物：现先生成横幅，失败时按快照回滚本轮新增文件并保留原有产物，旧版固定产物延后到校验通过后删除，可原地重跑
- 聚合成员保留名改为大小写不敏感，`setSecurityData` 等驼峰标签不再覆盖客户端底座成员；单文件模式路径首段命中保留名时自动改名
- 文档缺少 `paths` 时静默成功，现以可读错误终止（`E_SPEC_INVALID`）；`components` 缺失、为 `null` 或路径项为 `null` 时归一或跳过并告警；无 `components.schemas` 时补写空契约出口
- Swagger 2.0 与空 `paths` 给出明确结论（`E_SPEC_INVALID` / `E_NO_ENDPOINTS`）
- `procedure-call` 渲染不再回写共享路由的 `query.type`，同一路由多次渲染结果稳定
- `deepMergeConfig` 与迁移的 `deepMerge` 用祖先栈检测循环引用，成环时给可读错误而不是栈溢出

### 📝 文档更新

- 补齐产物对象图契约（可枚举图无环、`http` 闭包持有链为预期、方法可解构）与 `--single-http-client` 口径，写明不要对 `api` 深合并 / 深克隆
- 补充失败回滚与可直接重跑、仅支持 OpenAPI 3 与无契约产物的口径
- README、docs 与技能同步 `base` + `docs`、`--target` / `--all`、`upgrade` 与横幅口径

### 🧹 清理移除

- 移除旧版产物结构特征识别与旧横幅锚点，产物归属只认当前中英锚点

## 1.3.4

> 2026-11-21 发布

### ✨ 新增功能

- 同目录其他配置输出与本配置相同或嵌套时以退出码 2 拒绝（JSON 模式返回 `E_CONFIG_CONFLICT`），避免横幅清理互删产物
- 输出目录为仓库根、配置目录或其祖先时拒绝清理并报错；单文件模式检测到旧分组产物时告警
- `--no-interactive` 与终端判定，需要交互时在非 TTY 环境直接以退出码 2 结束并给出等价非交互命令
- `swagger2api capabilities --json` 输出命令、配置项、退出码与技能参考索引，能力 ID 作为稳定契约
- `swagger2api skill --json` 补 references 索引，供 AI 按需加载
- 验收门禁校验注册表与 `--help`、技能能力地图、docs 能力总览、README 命令表一致
- `input.timeout`（默认 30000 毫秒）与 `--timeout` 覆盖，超时与网络错误转为可读提示并提示重试或改用本地快照，退出码 1
- `swagger2api --version` 输出版本号（纯文本一行），诊断 JSON 的 `toolVersion` 与之一致
- `swagger2api prune --dir <目录>` 清理废弃产物目录中的生成物，默认只列、`--yes` 才删，手写文件不受影响
- prune 拒绝仓库根、当前目录祖先、配置目录与软链接目录，`--json` 输出结构化清单供 AI 与 CI 消费

### 🔧 功能调整

- 产物清理与 `--check` 改为按生成横幅识别归属，移除系统临时目录里的产物清单
- `--check` 按缺失 / 不一致 / 多余三类输出并支持 `--json`，末尾给出稳定结论行
- `init`、`grouping` 在非终端环境改为报错退出 2，不读取 stdin、不猜测配置
- 未找到配置文件时提示 `swagger2api init` 或 `--config <文件>`，不再隐式进入交互向导
- 技能重构为能力地图（场景 → 命令 → 输出 → 下一步），新增 `capabilities.md` / `recipes.md` / `troubleshooting.md` 参考与退出码表，明确生成后必须跑 `--check`
- `--check` / `inspect` / `prune` 的 `--json` 统一带 `schemaVersion`、`toolVersion`、`command`、`ok`、`errorCode` 与 `actions`
- JSON 模式下人类日志改走 stderr，stdout 只输出一份可直接解析的 JSON
- `grouping` 的文档拉取同样受超时约束，非法超时值告警后回落默认

### 📝 文档更新

- 技能明确 AI / CI 一律显式传 `--config`
- 新增能力总览页并接入站点导航

## 1.3.3

> 2026-11-21 发布

### ✨ 新增功能

- `inspect --dir` 只读审计产物布局，报告模块体量、分片门面与固定产物缺失，`--strict` 下异常非 0 退出

### 🔧 功能调整

- `--check` 通过后按同一判据输出布局审计提示，不改变既有退出码

### 🐛 问题修复

- 分片装箱未复用 `minBucketRoutes`，尾片偏小时并入前一片（不超过 `maxRoutes`），消除碎片分片文件

### 📝 文档更新

- 补全 `grouping.split` 的默认阈值、对象覆写与 `false` 逃生口说明，明确业务仓可按需覆写
- 技能产物说明改为「命名空间只定调用面、模块文件按体量装箱」，新增离线产物的对齐与验收口径

## 1.3.2

> 2026-11-21 发布

### 🐛 问题修复

- 支持 `defaults` + `targets` 多目标配置，一条命令生成或校验全部目标，`--target <id>` 只执行指定目标
- 多目标生成前整体预校验 `id`、输入与输出目录，冲突时以退出码 2 结束且不写任何目标
- 新增 `surface` 命令，提取产物中的 `@request` / `@name` 与导出类型，支持 `--out` 写基线、`--compare` 比对增删
- 多目标按 `id` 分组，目标集合或格式版本变化按失败处理；`--requests-only` 只锁接口集合
- 新增 `typeCheck`（扁平）/ `output.typeCheck`（嵌套）配置，`enforce` 时在写盘后剥离 `.ts` / `.js` / `.d.ts` 中的 `// @ts-nocheck`
- `--check` 的临时产物走同一剥离处理后再比对，避免与真实产物误报不一致

## 1.3.1

> 2026-11-21 发布

### ✨ 新增功能

- 项目层默认配置文件改为 `swagger2api.json`，本地层 `swagger2api.local.json`，全局层 `~/.swagger2api.json`；旧名继续可用
- 同目录新旧配置并存时新名优先并告警，`init` / `grouping` 默认写入新名
- 契约按业务文件拆分，单归属进 `types/<业务文件>.ts`，多归属与未使用进 `types/shared.ts`
- `types/index` 改为显式导出 barrel，内部声明只在本文件导出、不进入公开面
- `grouping.collapse` 合并折叠键相同的组，复现单文件产物「同名属性即同组」的语义
- `output.prune`（`--prune-output`）按上一轮生成清单清理已消失的模块，不触碰手写文件与清单外产物
- `grouping.split` 自适应分桶与命名空间分片，按接口体量压缩模块文件数
- 分片门面以实例合并与类型合并保持 `api.<命名空间>.<方法>` 调用形态不变
- `--dry-run --json` 报表输出桶与分片规划，拆分结果可先预览
- 扁平 `swagger2api.json` 配置，业务仓只写项目口径，分组阈值与桶名由工具默认
- `--check` 生成到临时目录并与现有产物逐文件比对，不写真实目录
- `verify` 校验技能打包与定位（`files` / `skill` 命令 / npm 包内容），并调用全局 toolkit `skills lint`
- 包内技能 `skills/fxri-swagger2api/`，覆盖首次接入、旧配置迁移与产物结构判断
- `swagger2api skill` / `--print` / `--json` 只读定位技能入口，不写文件、不维护状态
- 契约出口固定为 `types/index`，聚合入口按 `export * from "./types"` 导出
- 旧版 `data-contracts` / `http-client` 残留会在生成成功后自动清理

### 🔧 功能调整

- 装箱后小于下限的桶与相邻桶合并（优先前一桶，且不超过上限），消除大命名空间夹出的碎片文件
- 手动 `--modular` 也按本轮生成文件写入清单，连续生成清理已消失模块
- `--check` 覆盖手动模式，能发现缺失与过期产物
- 分组产物底座改名，`http-client` 改为 `client`，`data-contracts` 改为 `types/` 目录

### ⚡ 优化改进

- `init` 的 `.gitignore` 片段新增本地配置忽略项，已有片段按需补齐
- JS 模式的运行时枚举随归属文件落盘，出口同步 re-export
- `typescript` 提升为运行时依赖，用于按声明解析契约引用
- 生成清单移入系统缓存且不再记录工具名与版本，产物目录保持干净
- toolkit 低于 1.17.6 或不可用时降级为本仓硬断言，并在 stderr 提示安装或升级
- `files` 白名单纳入 `skills` 并声明 `agentSkills`，技能随 npm 包发布
- 产物清单、按清单清理与手写护栏支持 `types/` 嵌套路径

### 🐛 问题修复

- 分组模块的共享请求器改为公开字段，两个组的类型交叉不再坍缩为 `never`
- 补分组对外面门禁的交叉类型断言，避免同类回归
- 分组产物的聚合入口补齐 `AxiosResponse`、`FullRequestParams`、`RequestParams`、`ContentType`、`HttpClient` 导出，包桶引用与单文件产物一致
- JS 模式分组模块声明补齐 `AxiosResponse` 导入，`AxiosParse` 推导不再退化为 `unknown`
- 分组模块改为注入聚合请求器，替换 `api.instance` 与 `setSecurityData` 会对所有组同时生效
- 组名撞上 `instance`、`request` 等聚合成员时改用追加序号，避免覆盖运行期能力
- `--replace-tags` 值不足时忽略该参数并告警，不再用空串清空 JSDoc 标签
- 目标模块名已被手写文件占用时终止生成并提示，不再静默覆盖
- 临时文档改落系统临时目录，`output.clean` 与收尾清理不再报 ENOENT
- JS 输出的聚合入口不再带泛型与可选参数语法，避免 `.js` 文件出现 TypeScript 写法

### 📝 文档更新

- 指南新增「AI 技能：什么时候需要」，README 与 `--help` 露出 `skill` 命令
- AGENTS 增加本仓库能力自举与规范真源说明

## 1.3.0

> 2026-11-21 发布

### ✨ 新增功能

- 分层配置 `.swagger2apirc.json` / `.swagger2apirc.local.json` / `~/.swagger2apirc.json`，支持段级覆盖与 `FX_S2A_*` 环境变量
- `swagger2api init` 交互向导与 `--from-script` 脚本迁移，`swagger2api config status` 排障命令
- `--config` 与 `--profile` 参数；旧命令行参数与 `saconfig.json` 保持兼容
- 外部 `$ref` 按官方策略校验（同源放行、其余仅公网 http(s)、逐跳校验重定向、拒绝私网与回环），不合规直接报错
- 注入与私网引用夹具，并在 `pnpm verify` 增加安全夹具步骤
- 分组输出，`output.mode = grouped`（或 `--modular`）时按组拆分多文件并补写聚合入口；每个模块文件只渲染本组接口，聚合入口共享同一个请求实例，调用形态保持 `api.<组>.<方法>`
- `grouping` 配置支持 rules / tag / path 三种策略与 minRoutes、maxRoutes 阈值，`--dry-run` 输出分组报表
- 分组命名契约，组名统一转为合法模块名——路径字符与标点作分隔、数字开头补前缀、超长截断加哈希、Windows 设备名与 `index` 等保留名追加序号；同名组各自独立并追加序号，不再合并或覆盖
- `grouping.names` 手工指定可读模块名，`--dry-run` 输出命名映射与重命名原因，`--dry-run --json` 输出结构化报表
- `swagger2api grouping` 展示标签与路径分布，交互式写入分组配置（非交互终端只输出报表）；规则策略支持逐条录入「匹配方式 + 匹配值 + 组名」
- 向导预览「原始组名 → 模块名」，对兜底名、保留名冲突与重名组询问改名并写入 `grouping.names`，手工名非法或冲突时拒绝写入
- `grouping.preserveTags`（默认 true），JSDoc 的 `@tags` 保留原始标签，分组名只用于文件与类名

### 🔧 功能调整

- 生成失败不再静默——存在不合规文档时以非 0 退出，并在 stderr 指出被忽略的文档
- 运行时下限放宽至 node 18.12.0，构建目标同步改为 node18，CI 新增 node18 运行时回归 job
- `swagger-typescript-api` 降到 13.0.28，13.1 起改用 biome WASM 格式化，在 node 18 上生成即失败

### ⚡ 优化改进

- `init` 写入受管 `.gitignore` 片段，避免个人配置误入库
- 补充 `swagger-typescript-api` 的最小类型声明与 `package.json` 的 `types` 入口
- 分组模式先生成命名表再渲染，模板类名与聚合挂载同源，生成后按命名表校验文件名与类名；`--replace-tags` 先于分组执行，避免模块名被二次改写
- 分组结果同时输出「方法:路径 → 原始标签」映射，供模板回显
- `tsconfig` 开启 `skipLibCheck`，适配降级后依赖自带的声明文件
- `lodash` 通过 overrides 升到 4.18.1，修复其代码注入与原型污染告警
- `pnpm verify` 新增分组产物一致性检查（axios / fetch 各生成一次，断言不串组且可解析）与分组命名边界检查
- Windows 与 GitLab CI 补 node18 运行时作业，覆盖平台 × 运行时下限组合

### 🐛 问题修复

- 把官方 13.12.2 的代码注入与 SSRF 修复回移到本工具生成链（路径、枚举、默认值、servers 地址转义）
- 批量生成失败提示不再统一归因为安全问题，改为按实际原因查看上方输出

### 📝 文档更新

- 说明 node18 线生成器版本的已知安全告警（代码注入 / SSRF）及其适用边界
- README、快速开始、首页与 FAQ 更新推荐用法（init → 生成 → grouping）与分组入口

### 🧹 清理移除

- 移除 `glob` 依赖，配置文件扫描改为内部递归遍历，保持原有匹配范围、忽略规则与排序

## 1.2.16

> 2026-11-13 发布

### ⚡ 优化改进

- 文档站导航与侧栏抽为 `docs/site-nav.json` 单一数据源，站点配置只做引用展开
- 导航与产物校验改由工具命令执行，删除三份本地校验脚本

## 1.2.15

> 2026-11-06 发布

### ✨ 新增功能

- 文档站 404 兜底页与导航规范校验

### 🔧 功能调整

- 配置选项从 CLI 参考拆为独立「配置参考」页，导航不再依赖锚点
- 页面标题「新手指南」「FAQ」统一为「快速开始」「常见问题」，全站链接文案同步

### ⚡ 优化改进

- 文档站校验补 404 两条断言（`search: false`、`sitemap.transformItems`），并在构建后核验产物
- 404 页加 `search: false`，不进入站内搜索索引
- 文档站顶栏收敛为 4 项、侧栏重排为 4 组，常见问题与更新日志统一进「帮助」
- 404 页从站点地图过滤，避免被搜索引擎当正常页面收录

### 🐛 问题修复

- 产物断言改为从 `404.md` 读取一级标题比对搜索索引，避免改标题后检查静默失效

## 1.2.14

> 2026-11-04 发布

### ✨ 新增功能

- 引入 vitest 与 `src/__tests__/`，为 URL 判定与命令行参数解析补首批单元测试，门禁新增「单元测试」步骤

### ⚡ 优化改进

- `pnpm verify` 本地按改动面跳过无关的安装与文档构建，CI 与 `--full` 恒全量

## 1.2.13

> 2026-11-03 发布

### 📝 文档更新

- 环境要求中的 Node.js 版本对齐 package.json 的 engines（>=20.19.0）

## 1.2.12

> 2026-11-03 发布

### ⚡ 优化改进

- 统一 package.json 元数据，补齐 publishConfig.access、repository 的 git+ 前缀、文档站 homepage 与 keywords，engines 对齐 node >=20.19.0，bin 改为对象形式
- tasks、changeset 等脚本改为经包装脚本调用全局 toolkit，未安装时跳过、设置 FX_REQUIRE_TOOLKIT=1 时失败

## 1.2.11

> 2026-11-03 发布

### ⚡ 优化改进

- 文档站主题升到 2.1，改为中性底 + 单站强调色
- README 补充 CI 与文档站徽章

## 1.2.10

> 2026-11-03 发布

### ⚡ 优化改进

- 文档站主题升到 1.1，渐变改为覆盖整页

## 1.2.9

> 2026-11-03 发布

### ✨ 新增功能

- 仓库级三方一致质量门，统一实现、文档与变更集校验

### ⚡ 优化改进

- CHANGELOG 文档镜像改用全局 `toolkit changelog doc`，删除本地重复脚本
- 验收与文档部署不再依赖本地同步脚本，未安装全局 toolkit 时跳过镜像检查
- 文档站接入统一主题，公共视觉规则由 toolkit 分发
- README 移除内部协作规则引用，更新日志去除发布运维细节
- 验收脚本补文档链接与新增变更集检查

### 🐛 问题修复

- 升级 axios / glob / swagger-typescript-api 并用 overrides 锁定 transitives，清除生产依赖漏洞

### 📝 文档更新

- README 补充 AGENTS.md 入口

## 1.2.8

> 2026-09-15 发布

### ⚡ 优化改进

- CHANGELOG 统一为 toolkit 现行口径——分组标题改用 9 语义槽位命名，条目剥离冗余类型前缀（类型已由分组标题承接）

## 1.2.7

> 2026-09-06 发布

### ✨ 新增功能

- 新增 VitePress 文档站（GitHub 与 GitLab Pages 双端自动部署）

### 🐛 问题修复

- 全面核对文档与实现一致性，修正无效命令示例（`--quick,-q` 连写、npx 裸名等）与偏差描述，统一 npx 作用域全名口径

### 📝 文档更新

- README 重构为橱窗式分层设计并重新生成 og-image

## 1.2.6

> 2026-09-06 发布

### ⚡ 优化改进

- 升级生产依赖 glob 至 v13，修复依赖漏洞与 deprecated 告警，CLI 行为无变化

## 1.2.5

> 2026-09-05 发布

### ⚡ 优化改进

- 发布清单补充 CHANGELOG.md 与 LICENSE，npm 包内可直接查看更新日志与许可信息

## 1.2.4

> 2026-09-04 发布

### ⚡ 优化改进

- 移除项目内 @fxri/toolkit 依赖，工程化能力（任务管理、变更集、发版）统一改用全局安装的 toolkit（1.6.1），包产物无任何变化

## 1.2.3

> 2026-09-04 发布

### 📦 其他变更

- 同步重发：内容与 1.2.2 完全一致，本版以新版本号重发，无新增功能改动

## 1.2.2

> 2026-09-04 发布

### ⚡ 优化改进

- 升级 @fxri/toolkit 至 1.6.1（含 tasks archive 双重 CR 换行修复）

### 📝 文档更新

- 更新方弦 ® 注册商标信息（商标状态由申请中更新为已核准注册，第 42 类注册号 89648411）

## 1.2.1

> 2026-09-03 发布

### ⚡ 优化改进

- 升级核心依赖（axios 1.12 → 1.20、swagger-typescript-api 13.2 → 13.12、tsup 8.5.0 → 8.5.1、@fxri/toolkit 1.1.3 → 1.3.0）

## 1.2.0

> 2026-09-03 发布

### ✨ 新增功能

- 接入 @fxri/toolkit，引入 changesets 变更集发版流程与 .tasks 任务管理（纯工程化，不影响 API）

## 1.1.13

> 2026-04-17 发布

### ✨ 新增功能

- 移除空组件定义（--remove-empty-components 参数）

## 1.1.12

> 2025-12-05 发布

### 🐛 问题修复

- 提取参数时将可能存在的引号包含在内

## 1.1.11

> 2025-10-15 发布

### 🔧 功能调整

- 提取响应接口改为 AxiosResponse

## 1.1.10

> 2025-10-15 发布

### 🔧 功能调整

- 提取响应接口改为 AxiosResponseRaw

## 1.1.9

> 2025-10-15 发布

### ✨ 新增功能

- 替换标签支持 2 个参数（正则表达式 + 替换字符串）

## 1.1.8

> 2025-10-13 发布

### 🐛 问题修复

- 提取响应模板配置错误

## 1.1.7

> 2025-10-13 发布

### 🔧 功能调整

- 调整打包逻辑

## 1.1.6

> 2025-10-13 发布

### ✨ 新增功能

- 提取响应，将 AxiosResponse 返回值转移到 raw 字段，根部字段自行定义
- 提取参数，将 query 参数中的指定对象字段提取为根部字段，支持多选

## 1.1.5

> 2025-10-12 发布

### 🔧 功能调整

- debug 模式使用更精简的配置

## 1.1.4

> 2025-10-12 发布

### 🐛 问题修复

- 默认开启扫描全部配置文件

## 1.1.3

> 2025-10-12 发布

### 🐛 问题修复

- 读取配置文件前先初始化参数

## 1.1.2

> 2025-10-12 发布

### 🔧 功能调整

- 调整 --remove-dts 参数

## 1.1.1

> 2025-10-12 发布

### ✨ 新增功能

- 多文档配置，默认文档改为 saconfig.json

## 1.1.0

> 2025-10-12 发布

### ✨ 新增功能

- 引入 tsup 构建，支持 cjs / esm / dts 多格式产物

### 🔧 功能调整

- 拆分脚本入口，接口生成改用导入执行

## 1.0.15

> 2025-10-11 发布

### ✨ 新增功能

- 快速模式，直接使用配置文件参数
- 支持 -rd 移除使用 --js 参数时生成的 d.ts 文件

## 1.0.0

> 2025-10-07 发布

### 🚨 重大变更

- 首个版本，上传项目并完成基于 swagger-typescript-api 的接口代码生成基础功能
