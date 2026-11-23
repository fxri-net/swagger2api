# 配置决策

> 由 `../SKILL.md` 按需加载。只列需要判断的字段；完整字段与层级规则见仓库 `docs/config.md`。

## 最小配置

```json
{
  "base": { "output": { "mode": "grouped" } },
  "docs": [
    { "id": "main", "source": "https://example.com/v3/api-docs", "output": "./src/api" }
  ]
}
```

`source` 支持 URL 字符串、本地文件字符串或 `{ url | file, headers, timeout }`；相对路径按配置文件所在目录解析。`output` 支持目录字符串或对象，`output.name` 不能带路径与扩展名。

## 决策项

| 字段 | 取值 | 什么时候改 |
| --- | --- | --- |
| `base.output.name` | 字符串，默认 `index` | 需要自定义入口文件名时；文档项 `output.name` 优先 |
| `base.output.mode` | `single`（默认）/ `grouped` | 接口多、单文件过大时切 `grouped` |
| `base.client` | `axios`（默认）/ `fetch` | 需要 fetch 客户端时显式配置 |
| `base.language` | `ts`（默认）/ `js` | 产物要与现有 JS 代码共存时选 `js`（同时生成声明） |
| `base.output.typeCheck` | `skip`（默认）/ `enforce` | 需要项目类型检查覆盖生成物时选 `enforce`（工具剥离 `@ts-nocheck`） |
| `base.types.responses` | 布尔，默认 `true` | 不需要响应类型信息时设 `false` |
| `base.types.extractQuery` | 字段名数组 | 后端把分页 / 筛选包在 query 对象里，需要提到根部时 |
| `base.types.extractResponseRaw` | 布尔，默认 `true` | 不需要 `raw` 字段时设 `false` |
| `base.naming.pathPrefixIndex` | 非负整数 | 路径首段是网关前缀、不该进命名时去掉 |
| `base.naming.tagRewrite` | `[匹配, 替换]` | 标签带环境前缀或需要统一命名时 |
| `base.grouping.split` | 默认（自适应分桶）/ 对象覆写阈值 / `false` | 通常保持默认；需要固定模块文件数或调整桶大小时覆写，`false` 仅作逃生口 |
| 聚合成员保留名 | — | 分组属性与单文件命名空间命中 `HttpClient` 成员时自动追加序号；`grouping.names` 手工名命中则报错 |
| 契约与类名冲突 | — | 契约名与模块类同名时类名避让（`api.<组>` 不变）；契约与底座同名时根出口显式导出底座 |
| `base.output.prune` | 分组模式默认开启 / `false` | 需要保留旧产物时填 `false`：只报告多余产物、不删除 |

## 多文档

同一应用多个 Swagger 文档用一份配置，公共口径写 `base`，文档项写 `docs`：

```json
{
  "base": { "output": { "mode": "grouped" } },
  "docs": [
    { "id": "base", "source": "https://example.com/base/v3/api-docs", "output": "./src/api/base" },
    { "id": "lc", "source": "https://example.com/lc/v3/api-docs", "output": "./src/api/lc" }
  ]
}
```

- `id` 唯一，用于 `--target`、日志与本地层覆盖；`name` 仍是入口文件名，文档项优先
- 工具写盘（`init` / `grouping` / `upgrade`）只写个性化配置：默认值不落盘（`client=axios`、`language=ts`、`output.name=index`、`output.mode=single`、`output.typeCheck=skip`、`output.banner=zh`、`types.responses=true`、`types.extractResponseRaw=true`、`input.timeout=0`），`docs` 与 `base` 重复项上提，短对象单行；`naming` / `grouping` 与 `types.extractQuery` 不省略
- 单文档直接生成；多文档交互勾选（默认全不选），非交互必须 `--target <id[,id]>` 或 `--all`
- `--check` / `--dry-run` 与生成共用同一选择结果
- 输出目录相同或互相嵌套会被拒绝（退出码 2，不落盘）
- 每个应用目录只维护一份配置；不同目录的配置各自独立，不跨目录合并

## 分层

- 项目层 `swagger2api.json`：随仓库提交，定义 `base` / `docs` / `profiles`。
- 本地层 `swagger2api.local.json`：个人覆盖，按文档 `id` 合并或追加，加入忽略清单，不提交。
- 全局层 `~/.swagger2api.json`：只允许 `base` / `profiles`。
- 环境变量按文档生效；优先级与字段映射见 `docs/config.md`。

## 判断顺序

1. 先确认 `docs[].source` 可访问、返回 OpenAPI / Swagger 文档。
2. 再定 `base.output.mode`：不确定时先用 `single` 生成，确认调用形态后再评估是否分组。
3. 最后按需加 `base.language`、`base.types`、`base.naming`；每加一项都跑一次 `--dry-run` 对比报表。
4. 旧配置（`defaults` / `targets` / `saconfig*`）先跑 `swagger2api upgrade --dry-run`，不要手抄。
