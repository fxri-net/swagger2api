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

## 配置文件

- 默认配置文件为 `saconfig.json`，由工具在脚本执行目录生成
- 生成代码结束后，如果参数有改动，配置文件会同步更新
- 配置项与 CLI 参数一一对应，完整字段见 [CLI 参考 · 配置选项](./cli#配置选项)

## swagger-typescript-api 扩展

本工具基于 swagger-typescript-api 封装，其原生配置选项可通过参数透传使用，[更多配置选项](https://fig.io/manual/swagger-typescript-api)参考官方文档。
