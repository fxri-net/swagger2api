---
layout: home
# 首页无正文 h1，显式给 title 避免浏览器标签出现「Swagger 转 API - Swagger 转 API」重复
title: Swagger 文档一键转 TS/JS API

hero:
  name: Swagger 转 API
  text: Swagger 文档一键转 TS/JS API
  tagline: 基于 swagger-typescript-api 封装的 CLI 工具。从 Swagger JSON 快速生成 TypeScript / JavaScript 接口代码，多文档配置一站管理，响应结构可自定义提取。
  actions:
    - theme: brand
      text: 30 秒上手
      link: ./getting-started
    - theme: alt
      text: 完整攻略
      link: ./guide
    - theme: alt
      text: GitHub
      link: https://github.com/fxri-net/swagger2api

features:
  - icon: 🚀
    title: 快速生成
    details: 从 Swagger JSON 快速生成 TS/JS 接口代码，一行命令跑通「配置 → 生成 → 调用」。
  - icon: 📁
    title: 多文档配置
    details: 自动扫描项目下全部 saconfig*.json 配置文件，多项目接口配置集中管理，避免重名接口冲突。
  - icon: ⚡
    title: 快速模式
    details: 配置文件参数齐全时跳过二次确认，直接按既有配置重新生成，搭配脚本一行命令更新接口。
  - icon: 🎯
    title: 唯一 operationId
    details: 接口地址与请求方法拼接生成唯一 ID，可选把无路径参数的 get 转为 query 作区分，告别 _n 后缀。
  - icon: 🧹
    title: 灵活裁剪
    details: 支持移除路径参数、移除地址前缀索引、替换标签、移除空组件定义，生成代码更干净。
  - icon: 📦
    title: 响应提取
    details: AxiosResponse 返回值可转移到 raw 字段，根部字段自行声明，配合响应拦截器灵活定制。
---

## 30 秒上手

按你的包管理器选一条安装，随后在项目目录执行：

::: code-group

```sh [pnpm]
pnpm add -g @fxri/swagger2api
```

```sh [npm]
npm install -g @fxri/swagger2api
```

```sh [yarn]
yarn global add @fxri/swagger2api
```

:::

```sh
# 交互式生成接口代码（npx/dlx 均需带作用域全名，裸写会拉取同名其他包）
npx @fxri/swagger2api
```

详细步骤见[新手指南](./getting-started)。

## 解决什么痛点

| 痛点 | 本工具的做法 |
| --- | --- |
| 后端 Swagger 文档到手，接口代码要手写 | 一行命令从 Swagger JSON 生成 TS/JS 接口文件，含请求方法与类型定义 |
| 多个项目的接口配置散落，更新要挨个跑 | 自动扫描全部 saconfig*.json，多选或一键全量更新 |
| 重名接口被加 _n 后缀，调用方看着懵 | 地址 + 请求方法拼接唯一 operationId，从源头避免重名 |
| 每次生成都要重新确认一遍参数 | 快速模式直接复用配置文件参数，一行命令静默更新 |

## 文档索引

| 文档 | 适合谁 |
| --- | --- |
| [新手指南](./getting-started) | 第一次接触，想 30 秒跑起来 |
| [完整攻略](./guide) | 日常使用：三种模式、响应提取、配置文件 |
| [CLI 参考](./cli) | 查命令、参数、默认值 |
| [FAQ](./faq) | 遇到问题先来这里找 |

## 环境要求

- Node.js >= 20

## 相关链接

- [npm 包页面](https://www.npmjs.com/package/@fxri/swagger2api)
- [GitHub 仓库](https://github.com/fxri-net/swagger2api)
- [Gitee 仓库](https://gitee.com/fxri/swagger2api)
