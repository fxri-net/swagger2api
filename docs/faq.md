# 常见问题

> 目标读者：遇到疑问来查答案的用户。按主题分组，先答结论再给细节。

## 解决什么问题

快速开始讲最短路径、完整攻略讲全流程，但真实使用中的疑问是碎片化的——本篇按「问题 → 答案」直给。没找到答案可去 [GitHub Issues](https://github.com/fxri-net/swagger2api/issues) 或 [Gitee Issues](https://gitee.com/fxri/swagger2api/issues) 提问。

## 安装与环境

### 命令找不到或报「不是内部或外部命令」？

分两种情况：

- 没装过：全局安装 `pnpm install -g @fxri/swagger2api`，或直接 `npx @fxri/swagger2api`
- 装过其他同名工具：带上作用域全名使用 `npx @fxri/swagger2api`

### Node 版本要求？

Node.js >= 18.12.0。运行时以 node18 为下限；node 18 线仅到 18.20.x，且已于 2025-04 停止维护、无安全补丁，条件允许时请升级到 node20 或更高。

### node 18 环境下依赖有安全告警怎么办？

node18 线使用 `swagger-typescript-api@13.0.28`：13.1 起改用 biome WASM 格式化，在 node 18 上无法生成；13.12.2 起要求 node20。该版本存在已公开的代码注入与 SSRF 告警（GHSA-w284-33mx-6g9v、GHSA-5f94-x226-ccpm、GHSA-38c3-wv3c-v3xj、GHSA-hqj5-cw9f-rx67、GHSA-h754-fxp7-88wx、GHSA-x36r-4347-pm5x），官方补丁只随 13.12.2+ 发布。本工具已把官方修复回移到自己的生成链上：路径、枚举、默认值与 `servers` 地址在写入代码前统一转义，外部 `$ref` 按官方策略校验（同源放行、其余仅公网 http(s)、逐跳校验重定向、拒绝私网与回环）。与官方唯一差异是不合规引用会直接报错并终止，而不是静默跳过。依赖 `lodash` 已通过 overrides 升到修复版；`pnpm audit` 仍会按版本列出上述 6 条，但利用路径已闭合。有条件时升级到 node20 并升回新版生成器即可彻底消除告警。

### 接口太多、单文件太大怎么办？

开启分组输出：`output.mode = "grouped"`（或 `--modular`），按 tag / 路径段 / 显式规则拆成多文件，同时生成一个聚合入口，调用形态仍是 `api.<组>.<方法>`。先用 `swagger2api grouping` 看标签与路径分布并写入分组配置，`--dry-run` 可先预览分组结果。详见[完整攻略 · 分组输出](./guide#分组输出)。

### 支持 Swagger 2.0 文档吗？

不支持。生成器只接受 OpenAPI 3；检测到 `swagger: "2.0"` 会直接报错并提示先转换，不会生成半成品。

### 文档没有接口或没有数据模型会怎样？

`paths` 为空时直接报「文档没有接口」并以退出码 1 结束；没有 `components.schemas` 时照常生成，`types/index` 为空出口（`export {}`），聚合入口的 `export * from "./types"` 仍然可用。

### 全局装还是项目里装？

个人多项目使用推荐全局装；团队项目推荐项目依赖，版本随仓库锁定，成员与 CI 环境自动一致。对比见[快速开始 · 安装](./getting-started#安装)。

## 配置与生成

### 配置文件在哪里？

每个前端应用目录一份 `swagger2api.json`，用 `base` + `docs` 描述共享口径与文档列表；工具自工作目录向上查找最近的配置。生成过程不回写配置。

### 多个项目的接口配置怎么管理？

每个应用目录各自维护一份 `swagger2api.json`，互不合并；同一应用有多个文档时在 `docs` 中逐项声明，交互勾选或 `--target` / `--all` 更新，详见[完整攻略 · 多文档](./guide#多文档)。

### 旧配置和 api:* 脚本怎么迁移？

执行 `swagger2api upgrade --dry-run` 预览，`--diff` 查看差异，确认后 `--yes` 应用；迁移会把直连脚本的个性化参数收敛进配置，脚本名与数量保持不变，并备份旧文件，可用 `--restore latest` 回退，详见[一键迁移](./upgrade)。

### 升级 swagger2api 会影响业务调用吗？

先用旧产物固定接口面基线（`swagger2api surface --out .swagger2api/surface.json`），再用同一份 swagger 快照重新生成并执行 `swagger2api surface --compare .swagger2api/surface.json`：接口集合与类型名一致即调用方式不变。本地快照生成方式见[CLI 参考 · 接口面基线](./cli#接口面基线)。

### 每次生成都要确认一遍参数，太繁琐？

新配置路径没有输入向导：单文档直接生成；多文档用 `--target <id>` 或 `--all` 显式选择，无需逐项确认。

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
