# FAQ

> 目标读者：遇到疑问来查答案的用户。按主题分组，先答结论再给细节。

## 解决什么问题

新手指南讲最短路径、完整攻略讲全流程，但真实使用中的疑问是碎片化的——本篇按「问题 → 答案」直给。没找到答案可去 [GitHub Issues](https://github.com/fxri-net/swagger2api/issues) 或 [Gitee Issues](https://gitee.com/fxri/swagger2api/issues) 提问。

## 安装与环境

### 命令找不到或报「不是内部或外部命令」？

分两种情况：

- 没装过：全局安装 `pnpm install -g @fxri/swagger2api`，或直接 `npx swagger2api`
- 装过其他同名工具：带上作用域全名使用 `npx @fxri/swagger2api`

### Node 版本要求？

Node.js >= 20。工具依赖的运行时特性以 node@20 为下限，更低版本不保证可用。

### 全局装还是项目里装？

个人多项目使用推荐全局装；团队项目推荐项目依赖，版本随仓库锁定，成员与 CI 环境自动一致。对比见[新手指南 · 安装](./getting-started#安装)。

## 配置与生成

### 配置文件在哪里？

默认 `saconfig.json`，在脚本执行目录生成。生成代码结束后如果参数有改动，配置文件会同步更新。

### 多个项目的接口配置怎么管理？

按【./**/saconfig*.json】规则扫描全部配置文件（如【saconfig.json】【saconfig.admin.json】【config/saconfig.json】等），多个时提供选择列表。搭配快速模式与加载全部配置文件参数，可实现一行命令更新所有项目的接口配置，详见[完整攻略 · 多文档配置](./guide#多文档配置)。

### 每次生成都要确认一遍参数，太繁琐？

用快速模式 `--quick,-q`：配置文件参数齐全时跳过确认，直接生成。搭配 `package.json` 脚本即一行命令更新接口。

### 生成的接口有重名后缀 _1、_2？

本工具用「接口地址 + 请求方法」拼接唯一 operationId，从源头避免重名。可选开启 `--convert-get,-cg` 把无路径参数的 get 转 query 作区分，详见[完整攻略 · 唯一 operationId](./guide#唯一-operationid-拼接规则)。

### 想要 JS 而不是 TS？

swagger-typescript-api 原生支持 `--js` 参数；搭配 `--remove-dts,-rd` 可移除使用 --js 参数时生成的 d.ts 文件。

## 调用与响应

### 生成的接口怎么调用？

直接调用生成的 API 类方法：

```typescript
import { Api } from "./api"

/** 请求器 */
export const request = new Api()
request.getUsers().then((res) => console.log(res))
```

### fetch 还是 axios 客户端？

客户端类型默认 fetch；需要 axios（如配合响应拦截器使用）时，透传 swagger-typescript-api 原生参数 `--axios` 即可切换。

### 使用 --extract-response-raw 不生效？

先确认是否传了 `--axios`：该参数仅 axios 客户端模板生效，客户端类型默认 fetch，不传 `--axios` 时该参数无效。生效后返回值结构会变化，需自行声明根部字段并在响应拦截器中设计实际返回值，详见[完整攻略 · 提取响应](./guide#提取响应--extract-response-raw-err)。

### 使用 --extract-response-raw 后返回值结构变了？

该参数把 AxiosResponse 返回值转移到 raw 字段，需自行声明根部字段并在响应拦截器中设计实际返回值，两步配合详见[完整攻略 · 提取响应](./guide#提取响应--extract-response-raw-err)。

### 更多 swagger-typescript-api 的参数能用吗？

可以，原生参数透传，[更多配置选项](https://fig.io/manual/swagger-typescript-api)参考官方文档。
