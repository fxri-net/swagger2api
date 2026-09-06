# CLI 参考

> 本工具的可执行文件名为 `swagger2api`；如本地装过其他同名工具，使用作用域全名 `@fxri/swagger2api`。

## 基本用法

```bash
npx @fxri/swagger2api [选项]

# 本地安装后可直接使用短名
swagger2api [选项]
```

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | string | - | Swagger JSON 文件路径或 URL，未配置时交互提示默认值 `https://example.com/v3/api-docs` |
| `output` | string | `'./src/api'` | 生成代码的输出目录 |
| `name` | string | `'index'` | 接口文件名称，默认后缀为ts |
| `--quick,-q` | boolean | `false` | 快速模式，直接使用配置文件参数，不再二次确认参数 |
| `--config,-c` | string | `'saconfig.json'` | 填写配置文件路径，支持多选，用【,】分隔 |
| `--config-all,-ca` | boolean | `false` | 加载全部配置文件，不进行选择 |
| `--config-scan,-cs` | boolean | `true` | 扫描全部配置文件，并提供选择列表 |
| `--replace-tags,-rt` | string[] | - | 替换标签，2个参数，第1个正则表达式（工具自动补^$头尾，整标签匹配），第2个替换字符串 |
| `--convert-get,-cg` | boolean | `false` | 转换无{.+}get为query；仅转换末段为 get 且紧邻前缀非【}】的地址 |
| `--remove-param,-rp` | boolean | `false` | 移除{.+}参数 |
| `--remove-prefix-index,-rpi` | number | 未设置 | 移除前缀索引；传 `-1` 或不传均表示不移除 |
| `--remove-dts,-rd` | boolean | `false` | 移除使用--js参数时生成的d.ts文件 |
| `--remove-empty-components,-rec` | boolean | `true` | 移除空组件定义 |
| `--extract-request-query,-erq` | string | - | 提取参数，将query参数中的指定对象字段提取为根部字段，支持多选，用【,】分隔，每个接口只提取第一次命中的字段 |
| `--extract-response-raw,-err` | boolean | `false` | 提取响应，将AxiosResponse返回值转移到raw字段，根部字段自行定义，使用该参数需在响应拦截中重新设计实际的返回值。仅 axios 客户端生效，需搭配 `--axios` 参数，详见[完整攻略 · 提取响应](./guide#提取响应--extract-response-raw-err) |

> 布尔类型的选项均支持显式传 `false` 关闭，如用 `--config-scan false` 关闭默认开启的配置扫描。选项与值需空格分隔，写作 `--config-scan,false` 连写形式不会被识别。

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
