# 快速开始

> 目标读者：第一次接触本工具的用户。读完能跑通「安装 → 配置 → 生成 → 调用」最短路径，并知道去哪查更细的内容。

## 解决什么问题

前后端联调时，后端给出 Swagger 文档，前端却要：

- 照着文档手写一个个请求函数和类型定义
- 接口一多就重名，调用时满屏 `_1`、`_2` 后缀
- 多个项目各有一份接口配置，更新要挨个跑命令

本工具把这些一次性解决：从 Swagger JSON 一行命令生成 TS/JS 接口文件，配置落盘可复用。

## 推荐用法（先配置，后一行生成）

```bash
# 1. 首次：交互式写入 swagger2api.json（随仓库提交，团队共享）
swagger2api init

# 2. 之后每次生成：读配置，无参即可
swagger2api

# 3. 接口多、单文件大：先选分组方式，再生成多文件 + 单一出口
swagger2api grouping
```

这套流程的要点：配置落在文件里而不是命令行，换人接手 clone 仓库后跑同样两条命令即可复现；需要临时改某一项时，命令行参数仍然优先于配置。

## 安装

三种方式按场景选一：

### 方式一：全局安装（推荐个人使用）

```bash
pnpm install -g @fxri/swagger2api   # pnpm
yarn global add @fxri/swagger2api   # yarn
```

装完在任意目录直接使用 `swagger2api` 命令。

### 方式二：项目依赖

```bash
pnpm install @fxri/swagger2api      # pnpm
yarn add @fxri/swagger2api          # yarn
```

适合团队项目：版本随仓库锁定，成员与 CI 环境自动一致。搭配 `package.json` 脚本使用（见下文）。

### 方式三：不安装、临时执行

```bash
npx @fxri/swagger2api               # npm / yarn
pnpm dlx @fxri/swagger2api          # pnpm
```

零安装先体验。⚠️ npx/dlx 必须带上作用域全名 `@fxri/swagger2api`——裸写 `npx swagger2api` 会拉取 npm 上同名的其他包。

## 生成接口代码

在项目目录执行：

```bash
swagger2api init   # 首次接入：交互生成配置
swagger2api        # 之后：读取最近的 swagger2api.json 直接生成
```

首次运行会引导填写必要信息，并生成项目包目录下的 `swagger2api.json`：

```json
{
  "url": "https://example.com/v3/api-docs",
  "output": "./src/api",
  "mode": "grouped",
  "client": "axios",
  "language": "ts",
  "responses": true,
  "query": "arg0"
}
```

| 字段 | 说明 |
| --- | --- |
| `url` / `file` | Swagger JSON 地址或本地文件 |
| `output` | 生成代码的输出目录，相对配置文件所在目录解析 |
| `mode` | `single` / `grouped`；分组模式自动分桶与分片 |
| `client` / `language` | `axios` / `fetch`、`ts` / `js` |
| `responses` / `query` 等 | 项目自己的口径，按需保留 |

分桶阈值、清理与产物校验由工具默认，不需要写进配置；产物归属靠文件头的生成横幅识别，不落任何持久状态。`swagger2api --check` 可校验产物是否与当前配置一致。

## 调用接口

直接调用生成的 API 类方法：

```typescript
import { Api } from "./api"

/** 请求器 */
export const request = new Api()
request.getUsers().then((res) => console.log(res))
```

## 搭配 PNPM 脚本

在 `package.json` 中添加（全局安装与项目依赖二选一）：

```json
{
  "scripts": {
    "api": "swagger2api"
  }
}
```

项目依赖方式用 `npx @fxri/swagger2api`：npx/dlx 必须带作用域全名，否则会拉到 npm 上同名的其他包。

之后 `pnpm api` 一行命令即可按既有配置静默更新接口代码。

参数含义见 [CLI 参考](./cli)；更细的玩法（多文档配置、响应提取声明）见[完整攻略](./guide)。
