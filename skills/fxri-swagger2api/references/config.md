# 配置决策

> 由 `../SKILL.md` 按需加载。只列需要判断的字段；完整字段与层级规则见仓库 `docs/config.md`。

## 最小配置

```json
{
  "input": { "url": "https://example.com/v3/api-docs" },
  "output": { "dir": "./src/api", "name": "index" },
  "client": { "type": "axios" }
}
```

本地文件用 `input.file`，相对路径按配置文件所在目录解析。

## 决策项

| 字段 | 取值 | 什么时候改 |
| --- | --- | --- |
| `output.mode` | `single`（默认）/ `grouped` | 接口多、单文件过大时切 `grouped` |
| `client.type` | `fetch`（默认）/ `axios` | 项目已用 axios 或需要拦截器时选 `axios` |
| `language.target` | `ts`（默认）/ `js` | 产物要与现有 JS 代码共存时选 `js`（同时生成声明） |
| `output.typeCheck` | `skip`（默认）/ `enforce` | 需要项目类型检查覆盖生成物时选 `enforce`（工具剥离 `@ts-nocheck`） |
| `types.responses` | 布尔 | 需要响应类型信息时开启 |
| `types.extractQuery` | 字段名数组 | 后端把分页 / 筛选包在 query 对象里，需要提到根部时 |
| `types.extractResponseRaw` | 布尔 | 需要在响应里保留原始 `raw` 时 |
| `naming.pathPrefixIndex` | 非负整数 | 路径首段是网关前缀、不该进命名时去掉 |
| `naming.tagRewrite` | `[匹配, 替换]` | 标签带环境前缀或需要统一命名时 |
| `grouping.split` | 默认（自适应分桶）/ 对象覆写阈值 / `false` | 通常保持默认；需要固定模块文件数或调整桶大小时覆写，`false` 仅作逃生口（一个命名空间一个文件） |
| 聚合成员保留名 | — | 分组属性与单文件命名空间命中 `HttpClient` 成员（大小写不敏感）时自动追加序号；`grouping.names` 手工名命中则报错 |
| 契约与类名冲突 | — | 契约名与模块类同名时类名避让（`api.<组>` 不变）；契约与底座同名时根出口显式导出底座，契约可从 `types` 引用 |
| `output.prune` | 分组模式默认开启 / `false` | 需要保留旧产物（人工比对、分批提交）时填 `false`：只报告多余产物、不删除；单文件模式不自动清理分组残留，只告警 |

## 多目标

同一仓多个 Swagger 文档用一份配置，公共口径写 `defaults`：

```json
{
  "defaults": { "mode": "grouped", "client": "axios" },
  "targets": [
    { "id": "base", "url": "https://example.com/base/v3/api-docs", "output": "./src/api/base" },
    { "id": "lc", "url": "https://example.com/lc/v3/api-docs", "output": "./src/api/lc" }
  ]
}
```

- `id` 唯一，`name` 仍是入口文件名；目标项覆盖 `defaults`
- 无参数跑全部，`--target <id>` 跑单个，`--check` 校验全部
- 输出目录相同或互相嵌套会被拒绝（退出码 2，不落盘）；目标内相对路径按配置文件所在目录解析
- 同一目录的多份配置也不允许共用或嵌套输出目录：产物按横幅归属，一边的清理会删掉另一边

## 分层

- 项目层 `swagger2api.json`：随仓库提交，团队共用。
- 本地层：个人地址、令牌等放本地文件，加入忽略清单，不提交。
- 环境变量可覆盖地址等敏感项；优先级与字段映射见 `docs/config.md`。

## 判断顺序

1. 先确认输入地址可访问、返回 OpenAPI / Swagger 文档。
2. 再定 `mode`：不确定时先用 `single` 生成，确认调用形态后再评估是否分组。
3. 最后按需加 `language`、`types`、`naming`；每加一项都跑一次 `--dry-run` 对比报表。
