# CLI 参考

> 本工具的可执行文件名为 `swagger2api`。npx/dlx 执行时必须带作用域全名 `@fxri/swagger2api`——裸写 `npx swagger2api` 会拉取 npm 上同名的其他包；本地安装后可直接使用短名。

## 基本用法

```bash
npx @fxri/swagger2api [选项]

# 本地安装后可直接使用短名
swagger2api [选项]
```

## 配置选项

完整的配置文件字段与命令行参数见[配置参考](./config)。

## 常用组合示例

```bash
# 快速模式，直接使用配置文件参数，不再二次确认参数
npx @fxri/swagger2api --quick

# 填写配置文件路径，支持多选，用【,】分隔，使用该配置后则不会触发配置扫描功能
npx @fxri/swagger2api --config saconfig.json

# 移除前缀索引（移除前 1 段路径）
npx @fxri/swagger2api --remove-prefix-index 0

# 替换标签，2个参数，第1个正则表达式（工具自动补^$头尾，整标签匹配），第2个替换字符串
npx @fxri/swagger2api --replace-tags "user" "userCenter"
```

## swagger-typescript-api 扩展

本工具基于 swagger-typescript-api 封装，`--axios`、`--responses`、`--js` 等原生参数可透传使用，[更多配置选项](https://fig.io/manual/swagger-typescript-api)参考官方文档。
