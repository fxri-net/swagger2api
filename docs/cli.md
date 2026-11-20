# CLI 参考

> 本工具的可执行文件名为 `swagger2api`。npx/dlx 执行时必须带作用域全名 `@fxri/swagger2api`——裸写 `npx swagger2api` 会拉取 npm 上同名的其他包；本地安装后可直接使用短名。

## 基本用法

```bash
npx @fxri/swagger2api [选项]

# 本地安装后可直接使用短名
swagger2api [选项]
```

## 子命令

```bash
# 默认：生成（无子命令时与原用法完全一致）
swagger2api [选项]

# 交互式建设配置（写入 .swagger2apirc.json）
swagger2api init

# 从既有 npm script 迁移参数到配置
swagger2api init --from-script package.json

# 查看配置分层与生效结果（--json 输出结构化内容）
swagger2api config status

# 查看分组分布并写入分组配置（交互式；非交互终端只输出报表）
swagger2api grouping
```

- `grouping` 向导会预览「原始组名 → 模块名」，并对兜底名、保留名冲突与重名组询问是否改名，结果写入 `grouping.names`；手工名非法或冲突时拒绝写入
- `--config <path>`：显式指定项目层配置文件（只替换项目层，全局层与本地层照常叠加）
- `--profile <name>`：选用配置文件内的命名预设
- `--modular`：按组拆分为多文件并生成聚合入口
- `--dry-run`：配合分组配置只输出报表——原始组名到文件 / 类 / 属性名的映射、重命名原因、未命中规则与预计新增文件，不写产物
- `--json`：与 `--dry-run` 组合时输出结构化报表，便于脚本消费

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
