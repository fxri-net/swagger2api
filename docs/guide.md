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

- 开启方式：配置 `output.mode = "grouped"`，或命令行加 `--modular`
- 分组策略：`grouping.strategy` 支持 `rules`（显式规则）、`tag`（首个标签）、`path`（路径段 + `pathDepth`），按数组顺序生效，未命中落到 `grouping.fallback`
- 阈值：`minRoutes` 低于阈值并入兜底组；`maxRoutes` 超过阈值按下一段路径再拆一层
- 预览：加 `--dry-run` 只输出分组报表（命名映射、未命中规则与预计新增文件），不生成文件；`swagger2api grouping` 展示标签与路径分布并写入分组配置
- 文档标签：`grouping.preserveTags`（默认 `true`）在 JSDoc 中保留原始标签，分组名只用于文件与类名
- 产物：`index.ts` 聚合入口 + `data-contracts.ts` + `http-client.ts` + 每模块一个文件；聚合类按组名挂载模块实例并共享同一个请求实例，调用形态仍是 `api.<组>.<方法>`
- 对外面：聚合入口与单文件产物导出面一致（`Api`、`HttpClient`、`ContentType`、`AxiosResponse`、`FullRequestParams`、`RequestParams` 与全部数据契约）；模块通过聚合实例注入共享请求器，替换 `api.instance` 或调用 `setSecurityData` 会对所有组同时生效
- 模块命名：组名经统一规则转为合法标识符——路径字符与标点只作分隔，数字开头补前缀，超长截断加短哈希，Windows 设备名与 `index` 等保留名追加序号；重名（含全半角、大小写折叠后同名）各自独立并追加序号，不做业务组合并
- 命名兼容：`grouping.collapse` 为 `true` 时合并折叠键相同的组（如 `opt` 与 `opt_`），复现单文件产物的合并语义；`instance`、`request` 等聚合成员名同样列入保留名，命中后追加序号
- 命名预览：`--dry-run` 打印「原始组名 → 文件 / 类 / 属性」映射与重命名原因，`--dry-run --json` 输出结构化结果；`grouping.names` 可对个别组指定可读名，只改名不改归属
- 生成校验：分组生成后会按命名表核对实际文件名、类名与聚合挂载，不一致直接报错；输出目录中的表外文件会提示，建议开启 `output.prune`（只清理清单内的旧产物，不碰手写文件）

```json
{
  "output": { "dir": "./src/api", "mode": "grouped" },
  "grouping": {
    "strategy": ["rules", "tag", "path"],
    "pathDepth": 0,
    "rules": [{ "match": { "prefix": "/admin" }, "group": "admin" }],
    "fallback": "misc"
  }
}
```

## 配置文件

> 新项目推荐使用分层配置 `swagger2api.json`（可随仓库提交，支持分组、清理与多产物；见[配置参考](./config)）；本节描述的是早期扁平配置 `saconfig.json`，仍完整兼容。

- 默认配置文件为 `saconfig.json`，由工具在脚本执行目录生成
- 生成代码结束后，如果参数有改动，配置文件会同步更新
- 配置项与 CLI 参数一一对应，完整字段见 [配置参考](./config)

## swagger-typescript-api 扩展

本工具基于 swagger-typescript-api 封装，其原生配置选项可通过参数透传使用，[更多配置选项](https://fig.io/manual/swagger-typescript-api)参考官方文档。
