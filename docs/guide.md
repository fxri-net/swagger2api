# 完整攻略

> 目标读者：已跑通最短路径、想系统了解各项能力的用户。覆盖三种使用模式、多文档管理、响应提取与配置文件。

## 三种使用模式

### 快速模式

1. 直接使用配置文件参数，若配置文件不存在或者参数不全（如第一次运行该工具），则不会进入该模式。

2. 通过 `--quick` 参数开启，搭配 `package.json` 脚本可实现一行命令静默更新接口代码。

### 指定配置

1. 指定配置文件路径，支持多选，用【,】分隔。

2. 使用该参数则不会触发扫描全部配置文件功能。

### 多文档配置

1. 默认配置文件为 saconfig.json，项目启动后会扫描当前项目下所有符合【./**/saconfig*.json】规则的文件（如【saconfig.json】【saconfig.admin.json】【config/saconfig.json】等），并在扫描到多个文件时提供选择列表，如只有一个文件，则直接进入下一步，该功能可在配置项中关闭。

2. 此功能扩展使用的话，可以作为一个独立工具使用，同时管理多个项目的接口配置。

3. 搭配上快速模式和加载全部配置文件参数，可以实现一行命令更新所有项目的接口配置。

## 唯一 operationId 拼接规则

利用现有参数拼接了新的 operationId 字段，避免了重名接口会出现【_n】后缀的情况：

- 将接口地址与请求方法拼接作为唯一 ID
- 通过可选参数 `--convert-get,-cg`，将不带【{.+}】参数的【get】改为【query】作区分
- 然后移除【{.+}】参数，并移除地址的第一个参数（`--remove-prefix-index,-rpi`）

## 提取响应（--extract-response-raw,-err）

> ⚠️ 该参数仅 axios 客户端生效：需搭配 swagger-typescript-api 原生参数 `--axios` 使用。客户端类型默认 fetch，不传 `--axios` 时该参数无效。

使用 `--extract-response-raw,-err` 后，AxiosResponse 返回值转移到 raw 字段，需两步配合：

### 1. 声明自定义的根部字段

以下字段为示例，请根据实际情况自行调整：

```typescript
declare module "." {
  interface AxiosResponse<T extends Record<string, any> = any> {
    /** 状态代码 */
    code: number
    /** 提示信息 */
    message: string
    /** 响应数据 */
    data: T["data"]
  }
}
```

### 2. 配置对应的返回值

```typescript
// 响应拦截
client.instance.interceptors.response.use(
  (response) => ({ code: 0, message: "", data: null, raw: response }),
  (error) => ({ code: -1, message: error.message, data: null, raw: error })
)
```

每个方法会返回 Promise，可通过 async/await 或 .then() 处理响应。如没有使用提取响应参数，则忽略该项。

## 提取参数（--extract-request-query,-erq）

将 query 参数中的指定对象字段提取为根部字段，支持多选，用【,】分隔，每个接口只提取第一次命中的字段。

该替换发生在类型声明层面：生成代码时把 query 参数的类型表达式整体替换为提取后的根部字段类型，运行时调用逻辑不变，请求时按新类型传参即可。

适用场景：后端把分页、筛选等公共参数包在 query 的一个对象里，提取后调用方直接传根部字段，不必层层嵌套。

## 分组输出

接口规模大时，可把生成结果按组拆成多个文件，并保留单一出口：

- 开启方式：配置 `mode: "grouped"`，或命令行加 `--modular`；`swagger2api` 无参即按最近的 `swagger2api.json` 生成
- 手动模式同样按清单管理：加 `--modular` 时也会记录本轮产物，连续生成会清掉已消失的模块，`--check` 可发现缺失与过期文件
- 分组策略：默认按路径首段分组；需要自定义时用 `grouping.strategy` 的 `rules`（显式规则）、`tag`（首个标签）、`path`（路径段 + `pathDepth`），按数组顺序生效，未命中落到 `grouping.fallback`
- 自适应分桶：默认自动启用。总量低于阈值只出一个模块文件，否则按命名空间顺序装箱；装箱后小于下限的桶会与相邻桶合并（优先前一桶，且不超过上限），避免大命名空间夹出碎片文件；单个超大命名空间再按子分类分片，分片由门面类做实例合并与类型合并，调用形态仍是 `api.<命名空间>.<方法>`
- 阈值不由业务配置：分桶与分片的阈值属于工具默认；`grouping.split: false` 仅作为回滚逃生口，关闭后回到一命名空间一文件
- 桶命名：未配置分类且只有一个桶时固定为 `Modules.ts`；配置 `categories` 时按分类名拆分，未命中分类的命名空间归入 `fallback`；契约统一落在 `types/` 目录，客户端底座固定为 `client.ts`
- 预览：加 `--dry-run` 只输出分组报表（命名映射、桶/分片规划、未命中规则与预计新增文件），不生成文件；`swagger2api grouping` 展示标签与路径分布并写入分组配置
- 文档标签：`grouping.preserveTags`（默认 `true`）在 JSDoc 中保留原始标签，分组名只用于文件与类名
- 产物：`index.ts` 聚合入口 + `client.ts` + `types/index.ts` + 每模块一个文件；聚合类按组名挂载模块实例并共享同一个请求实例，调用形态仍是 `api.<组>.<方法>`
- 契约目录：契约出口固定为 `types/index.ts`，聚合入口写 `export * from "./types"`；单文件模式不生成该目录
- 契约拆分：只被一个业务文件使用的类型进 `types/<业务文件>.ts`，被多个业务文件使用或未被使用进 `types/shared.ts`；互引的环整体留在同一文件，类型文件之间无环；公开面仍由 `types/index.ts` 显式导出，内部声明只在本文件导出、不进出口
- 升级退场：旧版的 `data-contracts.ts` / `http-client.ts` 不再生成，重新生成成功后自动删除残留
- 对外面：聚合入口与单文件产物导出面一致（`Api`、`HttpClient`、`ContentType`、`AxiosResponse`、`FullRequestParams`、`RequestParams` 与全部数据契约）；模块通过聚合实例注入共享请求器，替换 `api.instance` 或调用 `setSecurityData` 会对所有组同时生效；模块类额外暴露 `http` 字段（内部注入，勿直接调用）
- 模块命名：组名经统一规则转为合法标识符——路径字符与标点只作分隔，数字开头补前缀，超长截断加短哈希，Windows 设备名与 `index` 等保留名追加序号；重名（含全半角、大小写折叠后同名）各自独立并追加序号，不做业务组合并
- 命名兼容：`grouping.collapse` 为 `true` 时合并折叠键相同的组（如 `opt` 与 `opt_`），复现单文件产物的合并语义；`instance`、`request` 等聚合成员名同样列入保留名，命中后追加序号
- 命名预览：`--dry-run` 打印「原始组名 → 文件 / 类 / 属性」映射与重命名原因，`--dry-run --json` 输出结构化结果；`grouping.names` 可对个别组指定可读名，只改名不改归属
- 生成校验：分组生成后会按命名表核对实际文件名、类名与聚合挂载，不一致直接报错；生成清单存放在系统临时目录缓存，不进入仓库；`--check` 可校验产物是否与当前配置一致
- 分片与回滚：超大命名空间按「命名空间之后第一个非版本段」拆分片，由门面类合并实例与类型；`grouping.split: false` 仅作为回滚逃生口，关闭后回到一命名空间一文件
- 分桶预览：`--dry-run --json` 的 `split` 字段给出「桶 → 命名空间」与「命名空间 → 分片」，便于确认拆法是否符合预期

```json
{
  "url": "https://example.com/v3/api-docs",
  "output": "./src/api",
  "mode": "grouped",
  "client": "axios"
}
```

## AI 技能：什么时候需要

- **只在三种场景读取**：首次接入、迁移旧配置、调整产物结构。日常生成、`--check` 与验收不加载，避免把低频能力写成常驻流程。
- **激活方式**：`pnpm exec swagger2api skill --print` 输出包内技能入口全文；`swagger2api skill` 输出入口路径，`skill --json`
  输出 `{ entry, referencesDir, version }`。技能随 npm 包发布，升级依赖即升级技能；不安装、不写项目文件、不维护状态。
- **最短路径**：读技能 → 写最小 `swagger2api.json` → `--dry-run --json` 预览 → 生成 → `--check` 与项目类型检查。
- **配置决策项**：`mode` / `client` / `language` / `responses` / `query` / `pathPrefixIndex` / `tagRewrite`；
  先定输入与输出，其余按默认，逐项加完各跑一次预览。
- **既有边界**：生成物沿用 `// @ts-nocheck`，类型错误不进入下游检查；需要更强约束时在项目侧加类型探针，不手改生成物。
- **规范来源**：技能结构与版本递增的机械真源是全局 `@fxri/toolkit` 的 `skills lint` / `skills bump`；本仓只保留打包与定位硬断言。

## 配置文件

> 新项目推荐使用分层配置 `swagger2api.json`（可随仓库提交，支持分组、清理与多产物；见[配置参考](./config)）；本节描述的是早期扁平配置 `saconfig.json`，仍完整兼容。

- 默认配置文件为 `saconfig.json`，由工具在脚本执行目录生成
- 生成代码结束后，如果参数有改动，配置文件会同步更新
- 配置项与 CLI 参数一一对应，完整字段见 [配置参考](./config)

## swagger-typescript-api 扩展

本工具基于 swagger-typescript-api 封装，其原生配置选项可通过参数透传使用，[更多配置选项](https://fig.io/manual/swagger-typescript-api)参考官方文档。
