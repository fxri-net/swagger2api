# 配置参考

> 配置项既可在配置文件（推荐 `swagger2api.json`，早期 `saconfig.json` 仍兼容）中设置，也可通过命令行参数传入；两者字段一一对应。

## 分层配置（rc 文件）

除 `saconfig.json` 外，还支持与同基地工具链一致的分层配置：

| 层 | 文件 | 用途 |
| --- | --- | --- |
| 项目层 | `swagger2api.json` | 团队共享，随仓库提交 |
| 本地层 | `swagger2api.local.json` | 个人按项目覆盖，默认不入库 |
| 全局层 | `~/.swagger2api.json` | 个人跨项目偏好 |

查找方式为自工作目录向上找最近的配置文件；同目录新旧文件名并存时新名优先并告警。旧名 `.swagger2apirc.json`、`.swagger2apirc.local.json`、`~/.swagger2apirc.json` 继续可用，不做自动重命名。合并优先级为「命令行参数 > 环境变量 > 本地层 > 项目层 > 全局层 > 默认值」。

```json
{
  "input": { "url": "https://example.com/v3/api-docs" },
  "output": { "dir": "./src/api", "name": "index", "mode": "single", "clean": false, "prune": false },
  "client": { "type": "axios" },
  "language": { "target": "ts" },
  "types": { "responses": true, "unwrapData": false, "extractParams": false, "extractQuery": "arg0" },
  "naming": { "pathPrefixIndex": 0, "convertGetToQuery": true, "dropPathParams": true, "tagRewrite": ["[a-z_]+(.+)", ""] },
  "grouping": {
    "strategy": ["rules", "tag", "path"],
    "pathDepth": 0,
    "rules": [],
    "minRoutes": 0,
    "maxRoutes": 0,
    "fallback": "misc",
    "collapse": false,
    "names": {},
    "split": { "minRoutes": 150, "targetRoutes": 300, "maxRoutes": 450, "minBucketRoutes": 60, "categories": [], "fallback": "misc" }
  },
  "profiles": { "admin": { "output": { "dir": "./src/api/admin" } } }
}
```

- 环境变量：`FX_S2A_INPUT`、`FX_S2A_OUTPUT`、`FX_S2A_NAME`、`FX_S2A_CLIENT`、`FX_S2A_LANGUAGE`、`FX_S2A_CLEAN`
- 多套预设：`profiles` 内的命名预设用 `--profile <name>` 选用
- 排障：`swagger2api config status` 展示各层命中文件、生效字段与环境变量覆盖，`--json` 输出结构化结果
- 分组命名覆盖：`grouping.names` 以「原始组名 → 期望模块名」改写产物名，键可用原始名或折叠名（全半角、大小写不敏感），只改名不改接口归属；该表应写在项目层，本地层同名字段会整表替换项目层
- 合并同名组：`grouping.collapse` 为 `true` 时，折叠键相同的组（如 `opt` 与 `opt_`）合并为同一组，复现单文件产物「同名属性即同组」的语义；默认 `false` 时各自独立并追加序号
- 自适应分桶：`grouping.split` 为 `true` 时用默认阈值，或写成对象微调。总路由不超过 `minRoutes`（默认 150）只出一个模块文件；否则按 `categories` 装箱（`match.prefix` / `match.regex` 匹配命名空间名，未命中入 `fallback`），或按命名空间名称顺序装箱，每桶不超过 `targetRoutes`（默认 300），尾桶低于 `minBucketRoutes`（默认 60）并入前一桶；未配置分类时桶名取首个命名空间名并告警
- 命名空间分片：单命名空间超过 `maxRoutes`（默认 450）时按「命名空间之后第一个非版本段」拆分成分片文件，并生成门面类合并实例与类型；分片文件名属于内部产物，聚合属性名与调用形态不变。开启 `split` 后旧的 `minRoutes` / `maxRoutes` 被忽略并告警，关闭 `split` 即回滚到一命名空间一文件
- 保留名：`index`、`data-contracts`、`http-client` 等固定产物名，以及 `instance`、`request`、`setSecurityData` 等聚合成员名，命中后自动追加序号，避免覆盖生成能力或运行期成员
- 产物清理：`output.clean` 会清空整个输出目录（只适合纯生成目录）；`output.prune` 只删除上一轮 `.swagger2api.manifest.json` 清单内、本轮不再生成的文件，不触碰手写适配文件与清单外产物，分组模式生成后自动写入清单
- 多产物目录：同一目录需要多份配置时用 `swagger2api.<产物>.json`（如 `swagger2api.mg.json`）并以 `--config` 指定；单产物目录直接运行即可自动命中 `swagger2api.json`
- 旧配置：`saconfig.json` 仍可用；两套同时存在时 rc 优先，并给出迁移提示

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
| `--replace-tags,-rt` | string[] | - | 替换标签，2个参数，第1个正则表达式（工具自动补^$头尾，整标签匹配），第2个替换字符串；值不足时忽略该参数并告警，保留原始标签 |
| `--convert-get,-cg` | boolean | `false` | 转换无{.+}get为query；仅转换末段为 get 且紧邻前缀非【}】的地址 |
| `--remove-param,-rp` | boolean | `false` | 移除{.+}参数 |
| `--remove-prefix-index,-rpi` | number | 未设置 | 移除前缀索引；传 `-1` 或不传均表示不移除 |
| `--remove-dts,-rd` | boolean | `false` | 移除使用--js参数时生成的d.ts文件 |
| `--prune-output` | boolean | `false` | 分组模式下按上一轮生成清单清理已消失的模块文件，不触碰手写文件与清单外产物 |
| `--remove-empty-components,-rec` | boolean | `true` | 移除空组件定义 |
| `--extract-request-query,-erq` | string | - | 提取参数，将query参数中的指定对象字段提取为根部字段，支持多选，用【,】分隔，每个接口只提取第一次命中的字段 |
| `--extract-response-raw,-err` | boolean | `false` | 提取响应，将AxiosResponse返回值转移到raw字段，根部字段自行定义，使用该参数需在响应拦截中重新设计实际的返回值。仅 axios 客户端生效，需搭配 `--axios` 参数，详见[完整攻略 · 提取响应](./guide#提取响应--extract-response-raw-err) |

> 布尔类型的选项均支持显式传 `false` 关闭，如用 `--config-scan false` 关闭默认开启的配置扫描。选项与值需空格分隔，写作 `--config-scan,false` 连写形式不会被识别。

## 相关页面

- 参考：[CLI 参考](./cli) · [完整攻略](./guide) · [常见问题](./faq)
