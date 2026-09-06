<p align="center">
  <img src="./docs/public/logo.png" width="128" alt="Swagger 转 API">
</p>

# Swagger 转 API

[![npm version](https://img.shields.io/npm/v/@fxri/swagger2api)](https://www.npmjs.com/package/@fxri/swagger2api)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](./docs/getting-started.md#安装)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

> 国内网络建议优先 [Gitee 镜像](https://gitee.com/fxri/swagger2api)（与 GitHub 同源同步）；问题反馈走 [GitHub Issues](https://github.com/fxri-net/swagger2api/issues) 或 [Gitee Issues](https://gitee.com/fxri/swagger2api/issues)。

基于 [swagger-typescript-api](https://github.com/acacode/swagger-typescript-api) 封装的 CLI 工具：Swagger 文档一键转 TS/JS 格式的 API 文件。

后端给到 Swagger 文档，接口代码还要照着手写；接口一多重名 `_n` 后缀满屏；多个项目的接口配置散落各处，更新要挨个跑命令。本工具把这些沉淀为**一行命令**：配置落盘可复用，生成静默无感，调用即取即用。

- **多文档配置**：自动扫描项目下全部 `saconfig*.json`，多项目接口集中管理，搭配快速模式一行命令全量更新（[怎么玩？](./docs/guide.md#多文档配置)）
- **唯一 operationId**：接口地址 + 请求方法拼接，从源头告别 `_n` 重名后缀（[拼接规则](./docs/guide.md#唯一-operationid-拼接规则)）
- **不懂生成的代码也能用**：接口文件含请求方法与类型定义，导入即调；参数全部有默认值，交互引导填写（[30 秒上手](./docs/getting-started.md)）

## 🚀 30 秒上手

```bash
# 1. 项目目录下临时执行（免安装；已安装则直接 swagger2api）
pnpm dlx @fxri/swagger2api

# 2. 按提示填写 Swagger 文档地址、输出目录、文件名
#    自动生成接口代码与 saconfig.json 配置文件
```

```typescript
import { Api } from "./src/api/index"

/** 请求器 */
export const request = new Api()
request.getUsers().then((res) => console.log(res))
```

完整步骤见 [新手指南](./docs/getting-started.md)。

## ✨ 能力矩阵

| 能力 | 适用场景 | 文档 |
| --- | --- | --- |
| 快速生成 | 从 Swagger JSON 生成 TS/JS 接口文件，含请求方法与类型定义 | [新手指南](./docs/getting-started.md) |
| 多文档配置 | 自动扫描 `./**/saconfig*.json`，多项目接口配置集中管理 | [完整攻略](./docs/guide.md#多文档配置) |
| 快速模式 | 配置齐全时跳过二次确认，搭配脚本一行命令静默更新 | [完整攻略](./docs/guide.md#快速模式) |
| 唯一 operationId | 接口地址 + 请求方法拼接唯一 ID，可选 get 转 query 作区分 | [完整攻略](./docs/guide.md#唯一-operationid-拼接规则) |
| 灵活裁剪 | 移除路径参数 / 前缀索引、替换标签、移除空组件定义 | [CLI 参考](./docs/cli.md#配置选项) |
| 响应提取 | AxiosResponse 转移到 raw 字段，根部字段自行声明 | [完整攻略](./docs/guide.md#提取响应--extract-response-raw-err) |
| STA 参数透传 | swagger-typescript-api 原生参数全量可用 | [CLI 参考](./docs/cli.md) |

## 📚 文档

| 文档 | 适合谁 |
| --- | --- |
| [新手指南](./docs/getting-started.md) | 第一次接触，想 30 秒跑起来 |
| [完整攻略](./docs/guide.md) | 日常使用：三种模式、响应提取、配置文件 |
| [CLI 参考](./docs/cli.md) | 查命令、参数、默认值 |
| [FAQ](./docs/faq.md) | 遇到问题先来这里找 |
| [完整文档站](https://fxri-net.github.io/swagger2api/) | 在线阅读体验 |

## 📦 安装

```bash
pnpm add -D @fxri/swagger2api   # 项目依赖（团队推荐，版本随仓库锁定）
pnpm i -g @fxri/swagger2api     # 全局（个人多项目推荐）
pnpm dlx @fxri/swagger2api      # 不安装临时执行
```

npm / yarn 用户、同名工具冲突说明见 [新手指南 · 安装](./docs/getting-started.md#安装)。

## 📁 多文档配置

默认配置文件为 `saconfig.json`；工具会扫描项目下所有 `saconfig*.json`（如 `saconfig.admin.json`、`config/saconfig.json`），多文件时提供选择列表。搭配快速模式与加载全部配置参数，`package.json` 一行脚本即可静默更新所有项目的接口代码：

```json
{
  "scripts": {
    "api": "swagger2api --axios --responses -q -rpi 0 -err -ca"
  }
}
```

此功能扩展使用的话，可以作为一个独立工具使用，同时管理多个项目的接口配置。详见 [完整攻略 · 多文档配置](./docs/guide.md#多文档配置)。

## ⚙️ 环境要求

- Node.js >= 20

## 📄 版权信息

作者：唐启云 <tqy@fxri.net>

出品：方弦研究所

版权：Copyright © 2025-2026 唐启云. All rights reserved.

网站：[方弦研究信息网](https://fxri.net:444/)

协议：[MIT License](./LICENSE)

商标："方弦®"为第42类注册商标（注册号89648411），本开源许可不授予商标使用权，详见 [TRADEMARK.md](./TRADEMARK.md)

> 方弦研究所为唐启云个人项目品牌与出品方，非独立法人实体；本软件著作权归唐启云所有。
