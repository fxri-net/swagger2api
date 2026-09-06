# 新手指南

> 目标读者：第一次接触本工具的用户。读完能跑通「安装 → 配置 → 生成 → 调用」最短路径，并知道去哪查更细的内容。

## 解决什么问题

前后端联调时，后端给出 Swagger 文档，前端却要：

- 照着文档手写一个个请求函数和类型定义
- 接口一多就重名，调用时满屏 `_1`、`_2` 后缀
- 多个项目各有一份接口配置，更新要挨个跑命令

本工具把这些一次性解决：从 Swagger JSON 一行命令生成 TS/JS 接口文件，配置落盘可复用。

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
swagger2api
```

首次运行会引导填写三个基础参数并生成配置文件 `saconfig.json`：

```json
{
  "url": "https://example.com/v3/api-docs",
  "output": "./src/api",
  "name": "index"
}
```

| 字段 | 说明 |
| --- | --- |
| `url` | Swagger JSON 文件路径或 URL |
| `output` | 生成代码的输出目录 |
| `name` | 接口文件名称，默认后缀为 ts |

生成结束后自动保存配置文件。

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
    "api": "swagger2api --axios --responses -q -rpi 0 -err"
  }
}
```

```json
{
  "scripts": {
    "api": "npx @fxri/swagger2api --axios --responses -q -rpi 0 -err"
  }
}
```

之后 `pnpm api` 一行命令即可按既有配置静默更新接口代码。

参数含义见 [CLI 参考](./cli)；更细的玩法（多文档配置、响应提取声明）见[完整攻略](./guide)。
