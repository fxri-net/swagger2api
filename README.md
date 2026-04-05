# @fxri/swagger2api

基于 swagger-typescript-api，将 Swagger 文档自动转为 TS/JS 格式的 API 文件。

## ✨ 特性

- 🚀 **快速生成** - 从 Swagger JSON 快速生成 TS/JS 接口代码。
- 📁 **特性区别** - 利用现有参数拼接了新的 operationId 字段，避免了重名接口会出现【_n】后缀的情况。
- 📝 **拼接规则** - 将接口地址与请求方法拼接作为唯一ID，通过可选参数，将不带【{.+}】参数的【get】改为【query】作区分，然后移除【{.+}】参数，并移除地址的第一个参数。
- ⚙️ **环境依赖** - 工具需要在 node@20 及以上运行时环境下使用。
- 🔧 **CLI 工具** - 更多参数可查看 swagger-typescript-api 官方文档。

## 💡 功能简介

### 快速模式

1.直接使用配置文件参数，若配置文件不存在或者参数不全（如第一次运行该工具），则不会进入该模式。

### 指定配置

1.指定配置文件路径，支持多选，用【,】分隔。

2.使用该参数则不会触发扫描全部配置文件功能。

### 多文档配置

1.默认配置文件为saconfig.json，项目启动后会扫描当前项目下所有符合【./**/saconfig*.json】规则的文件（如【saconfig.json】【saconfig.admin.json】【config/saconfig.json】等），并在扫描到多个文件时提供选择列表，如只有一个文件，则直接进入下一步，该功能可在配置项中关闭。

2.此功能扩展使用的话，可以作为一个独立工具使用，同时管理多个项目的接口配置。

3.搭配上快速模式和加载全部配置文件参数，可以实现一行命令更新所有项目的接口配置。

## 📦 安装

pnpm

```bash
# 全局安装
pnpm install -g @fxri/swagger2api
```

```bash
# 项目依赖
pnpm install @fxri/swagger2api
```

yarn

```bash
# 全局安装
yarn global add @fxri/swagger2api
```

```bash
# 项目依赖
yarn add @fxri/swagger2api
```

## 📝 PNPM 脚本

在 `package.json` 中添加：

生成 axios http 客户端，生成有关请求响应的附加信息，移除第一个前缀索引，使用快速模式。

```json
{
  "scripts": {
    "api": "swagger2api --axios --responses -q -rpi 0 -err"
  }
}

{
  "scripts": {
    "api": "npx @fxri/swagger2api --axios --responses -q -rpi 0 -err"
  }
}
```

## 🚀 快速开始

### 1. 生成接口代码

如果没装过其他名字叫 swagger2api 的工具，那么在 shell 中直接使用就行，如果装过同名工具，则需要带上 @fxri 作用域。

```bash
npx swagger2api
```

```bash
npx @fxri/swagger2api
```

### 2. 配置文件说明

工具在脚本执行目录生成配置文件，作为生成接口时的默认参数，生成代码结束后，如果参数有改动，则会更新配置文件：

```json
{
  "url": "https://example.com/v3/api-docs",
  "output": "./src/api",
  "name": "index"
}
```

### 3. 调用接口

直接调用生成的API类方法：

```typescript
import { Api } from "./api"
/** 请求器 */
export const request = new Api()
request.getUsers().then((res) => console.log(res))
```

### 4. 提取响应（如没有使用提取响应参数，则忽略该项）

声明自定义的根部字段（以下字段为示例，请根据实际情况自行调整）：

```typescript
declare module "." {
  interface AxiosResponse<T extends { [key: string]: any } = any> {
    /** 状态代码 */
    code: number
    /** 提示信息 */
    message: string
    /** 响应数据 */
    data: T["data"]
  }
}
```

根据已声明字段，配置对应的返回值：

```typescript
// 响应拦截
client.instance.interceptors.response.use(
  (response) => ({ code: 0, message: "", data: null, raw: response }),
  (error) => ({ code: -1, message: error.message, data: null, raw: error })
)
```

每个方法会返回 Promise，可通过 async/await 或 .then() 处理响应。

## ⚙️ 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | string | - | Swagger JSON 文件路径或 URL |
| `output` | string | `'./src/api'` | 生成代码的输出目录 |
| `name` | string | `'index'` | 接口文件名称，默认后缀为ts |
| `--quick,-q` | boolean | `false` | 快速模式，直接使用配置文件参数，不再二次确认参数 |
| `--config,-c` | string | `'saconfig.json'` | 填写配置文件路径，支持多选，用【,】分隔 |
| `--config-all,-ca` | boolean | `false` | 加载全部配置文件，不进行选择 |
| `--config-scan,-cs` | boolean | `true` | 扫描全部配置文件，并提供选择列表 |
| `--replace-tags,-rt` | string[] | - | 替换标签，2个参数，第1个正则表达式（已包含^$头尾），第2个替换字符串 |
| `--convert-get,-cg` | boolean | `false` | 转换无{.+}get为query |
| `--remove-param,-rp` | boolean | `false` | 移除{.+}参数 |
| `--remove-prefix-index,-rpi` | number | `-1` | 移除前缀索引 |
| `--remove-dts,-rd` | boolean | `false` | 移除使用--js参数时生成的d.ts文件 |
| `--extract-request-query,-erq` | string | - | 提取参数，将query参数中的指定对象字段提取为根部字段，支持多选，用【,】分隔，每个接口只提取第一次命中的字段 |
| `--extract-response-raw,-err` | boolean | `false` | 提取响应，将AxiosResponse返回值转移到raw字段，根部字段自行定义，使用该参数需在响应拦截中重新设计实际的返回值 |

扩展：[更多 swagger-typescript-api 配置选项](https://fig.io/manual/swagger-typescript-api)

## 🔧 CLI 命令

```bash
# 快速模式，直接使用配置文件参数，不再二次确认参数

npx swagger2api [--quick,-q] [--quick,-q <boolean>]

npx @fxri/swagger2api [--quick,-q] [--quick,-q <boolean>]
```

```bash
# 填写配置文件路径，支持多选，用【,】分隔，使用该配置后则不会触发配置扫描功能

npx swagger2api [--config,-c <path>]

npx @fxri/swagger2api [--config,-c <path>]
```

```bash
# 移除前缀索引

npx swagger2api [--remove-prefix-index,-rpi <number>]

npx @fxri/swagger2api [--remove-prefix-index,-rpi <number>]
```

```bash
# 替换标签，2个参数，第1个正则表达式（已包含^$头尾），第2个替换字符串

npx swagger2api [--replace-tags,-rt <regexp> <substr>]

npx @fxri/swagger2api [--replace-tags,-rt <regexp> <substr>]
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 版权信息

作者：唐启云 <tqy@fxri.net>

版权：Copyright © 2025 方弦研究所. All rights reserved.

网站：[方弦研究信息网](https://fxri.net:444/)

协议：MIT License