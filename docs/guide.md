# 完整攻略

> 目标读者：已跑通最短路径、想系统了解各项能力的用户。覆盖使用模式、多文档管理、响应提取与配置文件。

## 使用模式

### 单文档

每个前端应用目录一份 `swagger2api.json`，`docs` 只写一个文档项；运行 `swagger2api` 直接生成，不提问。

### 多文档

同一应用有多个 Swagger 文档时，在 `base` 写公共口径，`docs` 逐项声明：

```json
{
  "base": { "output": { "mode": "grouped" } },
  "docs": [
    { "id": "base", "source": "https://example.com/base/v3/api-docs", "output": "./src/api/base" },
    { "id": "lc", "source": "./swagger/lc.json", "output": "./src/api/lc" }
  ]
}
```

- 交互环境：运行 `swagger2api` 后勾选要更新的文档，默认全不选；空格切换、回车确认，空选退出 0。
- 非交互 / 脚本环境：必须显式 `--target base[,lc]` 或 `--all`，否则退出 2。
- `--check` / `--dry-run` 与生成共用同一选择结果。
- 每个应用目录只维护一份配置；不同应用的配置各自独立，不跨目录合并。

### 指定配置

`--config <path>` 只替换项目层配置文件，全局层与本地层照常叠加；只接受单个文件。

## 唯一 operationId 拼接规则

利用现有参数拼接了新的 operationId 字段，避免了重名接口会出现【_n】后缀的情况：

- 将接口地址与请求方法拼接作为唯一 ID
- 通过可选参数 `--convert-get,-cg`，将不带【{.+}】参数的【get】改为【query】作区分
- 然后移除【{.+}】参数，并移除地址的第一个参数（`--remove-prefix-index,-rpi`）

## 提取响应（--extract-response-raw,-err）

> ⚠️ 该参数仅 axios 客户端生效：默认客户端即 axios，不需要额外参数；配置 `client: "fetch"` 或传 `--fetch` 时不生效。默认已开启，需要关闭时传 `--no-extract-response-raw`。

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
- 手动模式同样按横幅清理：加 `--modular` 时连续生成会清掉已消失的模块与残留契约，手写文件不受影响，`--check` 可发现缺失、不一致与多余文件
- 分组策略：默认按路径首段分组；需要自定义时用 `grouping.strategy` 的 `rules`（显式规则）、`tag`（首个标签）、`path`（路径段 + `pathDepth`），按数组顺序生效，未命中落到 `grouping.fallback`
- 自适应分桶：默认自动启用。总量低于阈值只出一个模块文件，否则按命名空间顺序装箱；装箱后小于下限的桶会与相邻桶合并（优先前一桶，且不超过上限），避免大命名空间夹出碎片文件；单个超大命名空间再按子分类分片，分片由门面类做实例合并与类型合并，调用形态仍是 `api.<命名空间>.<方法>`
- 阈值不由业务配置：分桶与分片的阈值属于工具默认；`grouping.split: false` 仅作为回滚逃生口，关闭后回到一命名空间一文件
- 桶命名：未配置分类且只有一个桶时固定为 `Modules.ts`；配置 `categories` 时按分类名拆分，未命中分类的命名空间归入 `fallback`；契约统一落在 `types/` 目录，客户端底座固定为 `client.ts`
- 预览：加 `--dry-run` 只输出分组报表（命名映射、桶/分片规划、未命中规则与预计新增文件），不生成文件；`swagger2api grouping` 展示标签与路径分布并写入分组配置
- 文档标签：`grouping.preserveTags`（默认 `true`）在 JSDoc 中保留原始标签，分组名只用于文件与类名
- 产物：`index.ts` 聚合入口 + `client.ts` + `types/index.ts` + 每模块一个文件；聚合类按组名挂载模块实例并共享同一个请求实例，调用形态仍是 `api.<组>.<方法>`
- 契约目录：契约出口固定为 `types/index.ts`，聚合入口写 `export * from "./types"`；单文件模式不生成该目录
- 契约拆分：只被一个业务文件使用的类型进 `types/<业务文件>.ts`，被多个业务文件使用或未被使用进 `types/shared.ts`；互引的环整体留在同一文件，类型文件之间无环；公开面仍由 `types/index.ts` 显式导出，内部声明只在本文件导出、不进出口
- 契约导入：TS 产物的模块文件与 `route-types` 只对运行时枚举按值导入，其余纯类型统一写 `import type`，开启 `verbatimModuleSyntax` 的项目不会因残留类型导入在运行期解析失败；JS 产物的声明文件不参与运行期，仍按值导入
- 升级退场：旧版的 `data-contracts.ts` / `http-client.ts` 不再生成，重新生成成功后自动删除残留
- 对外面：聚合入口与单文件产物导出面一致（`Api`、`HttpClient`、`ContentType`、`AxiosResponse`、`FullRequestParams`、`RequestParams` 与全部数据契约）；模块通过聚合实例注入共享请求器，替换 `api.instance` 或调用 `setSecurityData` 会对所有组同时生效；模块类额外暴露只读 `http` 字段（内部注入，运行期不可枚举、不可写，勿直接调用）
- 模块命名：组名经统一规则转为合法标识符——路径字符与标点只作分隔，数字开头补前缀，超长截断加短哈希，Windows 设备名与 `index` 等保留名追加序号；重名（含全半角、大小写折叠后同名）各自独立并追加序号，不做业务组合并
- 命名兼容：`grouping.collapse` 为 `true` 时合并折叠键相同的组（如 `opt` 与 `opt_`），复现单文件产物的合并语义；`instance`、`request` 等聚合成员名同样列入保留名，命中后追加序号
- 命名预览：`--dry-run` 打印「原始组名 → 文件 / 类 / 属性」映射与重命名原因，`--dry-run --json` 输出结构化结果；`grouping.names` 可对个别组指定可读名，只改名不改归属
- 生成校验：分组生成后会按命名表核对实际文件名、类名与聚合挂载，不一致直接报错；产物归属靠文件头的生成横幅识别，不落任何持久状态；`--check` 可校验产物是否与当前配置一致
- 横幅语言：文件头来源说明默认中文，`output.banner: "en"` 可切回英文，两种语言结构一致；模块共享请求器以不可枚举方式注入，深合并或序列化不会沿聚合入口成环
- 分片与回滚：超大命名空间按「命名空间之后第一个非版本段」拆分片，由门面类合并实例与类型；`grouping.split: false` 仅作为回滚逃生口，关闭后回到一命名空间一文件
- 分桶预览：`--dry-run --json` 的 `split` 字段给出「桶 → 命名空间」与「命名空间 → 分片」，便于确认拆法是否符合预期

### 对象图与合并安全

生成物的运行期对象图是固定契约：

- 聚合入口持有各模块实例；模块与分片门面以不可枚举的 `http` 回指共享请求器，axios 客户端下 `instance` 是原型上的 getter；`--single-http-client` 时 `Api` 自身的 `http` 同样不可枚举
- `HttpClient` 的 `instance`、`securityData`、`securityWorker`、`secure`、`format` 都是不可枚举的自有字段，`setSecurityData(api)` 这类自引用不会进入可枚举图
- 从聚合入口按可枚举属性遍历只到模块与方法，**不存在属性环**；`JSON.stringify(api)` 可用，`dgClone` / `dgMerge` 触不到 `http` 与 Axios 图
- 方法是以箭头字段生成的自有可枚举函数，可直接解构或当回调；代价是方法仍被引用时客户端实例不会释放，属预期行为
- 使用约束：不要对 `api` 实例做深合并、深克隆或 `structuredClone`；不要用 `JSON.stringify(module)` 判断模块状态；`http` 只读，换实例请走 `api.instance` 或 `setSecurityData`
- 工具侧 `deepMergeConfig` 与迁移的 `mergeDeep` 用祖先栈检测配置环，遇到循环引用给可读错误而不是栈溢出

```json
{
  "base": { "output": { "mode": "grouped" } },
  "docs": [
    { "id": "main", "source": "https://example.com/v3/api-docs", "output": "./src/api" }
  ]
}
```

## AI 技能：什么时候需要

- **只在三种场景读取**：首次接入、迁移旧配置、调整产物结构。日常生成、`--check` 与验收不加载，避免把低频能力写成常驻流程。
- **激活方式**：`pnpm exec swagger2api skill --print` 输出包内技能入口全文；`swagger2api skill` 输出入口路径，`skill --json`
  输出 `{ entry, referencesDir, version }`。技能随 npm 包发布，升级依赖即升级技能；不安装、不写项目文件、不维护状态。
- **最短路径**：读技能 → 写最小 `swagger2api.json` → `--dry-run --json` 预览 → 生成 → `--check` 与项目类型检查。
- **配置决策项**：`docs[].source` / `docs[].output` / `base.output.mode` / `base.client` / `base.language` / `base.output.typeCheck` / `base.types.responses` / `base.naming`；
  先定文档输入输出，其余按默认，逐项加完各跑一次预览。
- **既有边界**：生成物默认沿用 `// @ts-nocheck`，类型错误不进入下游检查；需要类型检查接管时用 `typeCheck: "enforce"`，由工具剥离后再校验，不手改生成物。
- **规范来源**：技能结构与版本递增的机械真源是全局 `@fxri/toolkit` 的 `skill lint` / `skill bump`；本仓只保留打包与定位硬断言。

## 配置文件

- 每个前端应用目录一份 `swagger2api.json`，`base` 写共享口径，`docs` 逐项声明输入输出；完整字段见 [配置参考](./config)。
- 个人覆盖写在 `swagger2api.local.json`，按文档 `id` 合并，默认不入库；全局偏好放 `~/.swagger2api.json`，只允许 `base` / `profiles`。
- 生成代码不会回写配置；需要调整参数时直接改配置或命令行。
- 旧 `saconfig*`、`.swagger2apirc*`、`defaults` + `targets` 与直连 `swagger2api` 的脚本用 [`swagger2api upgrade`](./upgrade) 迁移：只收敛参数、不增删脚本，支持差异预览、备份与回退。

## swagger-typescript-api 扩展

本工具基于 swagger-typescript-api 封装，其原生配置选项可通过参数透传使用，[更多配置选项](https://fig.io/manual/swagger-typescript-api)参考官方文档。
