# 配置参考

> 推荐只维护一份 `swagger2api.json`：写项目自己的口径，其余由工具默认。早期 `saconfig.json` 与嵌套 rc 写法继续兼容。

## 项目配置（推荐）

把 `swagger2api.json` 放在产物所在包目录（或仓库根），运行 `swagger2api` 即自动命中：

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

- 根上可直接写：`url` / `file`、`output`、`name`（默认 `index`）、`mode`（`single` / `grouped`）、`typeCheck`（`skip` / `enforce`）、`client`（`axios` / `fetch`）、`language`（`ts` / `js`）、`responses`、`query`、`pathPrefixIndex`、`extractResponseRaw`、`convertGetToQuery`、`dropPathParams`、`tagRewrite`
- 只写项目自己的口径；分桶阈值、分片规则、清理与产物校验默认由工具决定，需要时可用 `grouping.split` 覆写（见下文「自适应分桶」）
- `typeCheck: "enforce"` 让类型检查接管生成物：写盘后剥离 `.ts` / `.js` / `.d.ts` 中独立成行的 `// @ts-nocheck`，`--check` 也按剥离后的产物比对；默认 `skip` 保留该行
- `mode: "grouped"` 自动按路径首段分组，并按体量分桶、对超大命名空间分片；对外仍是 `api.<命名空间>.<方法>`
- 产物布局：`mode: "grouped"` 固定为 `index`（聚合入口）+ 业务模块文件 + `client`（客户端底座）+ `types/`（契约目录），契约统一从 `types/index` 导出；契约再按业务文件拆分为 `types/<业务文件>.ts` 与 `types/shared.ts`
- 升级退场：旧版的 `data-contracts.ts` / `http-client.ts` 不再生成，重新生成成功后自动删除残留，无需手动清理
- 相对路径按配置文件所在目录解析，从任意目录执行都能落对位置
- 产物归属靠生成横幅识别：生成物（含聚合入口与契约）文件头带 `THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API`，手写文件不带；`--check` 与清理都以文件头前 1KB 判定，不依赖任何持久状态
- 不要手写生成目录、不要在自写文件里复用生成横幅，否则会被当成产物覆盖或清理
- `swagger2api init` 可交互生成这份配置；`swagger2api` 无参即按最近的配置生成

## 多目标配置

同一仓库有多个 Swagger 文档（如 `base` / `lc` / `mg`）时，用 `defaults` 写公共口径，`targets` 逐目标声明：

```json
{
  "defaults": { "mode": "grouped", "client": "axios", "language": "ts" },
  "targets": [
    { "id": "base", "url": "https://example.com/base/v3/api-docs", "output": "./src/api/base" },
    { "id": "lc", "url": "https://example.com/lc/v3/api-docs", "output": "./src/api/lc" }
  ]
}
```

- `id` 是目标标识，必须唯一；`name` 仍是生成入口文件名，默认 `index`
- 目标项既可写扁平字段（`url` / `file` / `output` / `name` / `mode` 等），也可写嵌套字段（`input` / `output` 等）
- 合并优先级：命令行 > 环境变量 > `profiles` > 目标项 > `defaults`；分层配置的本地层 > 项目层 > 全局层在读取时已完成合并，数组整体替换
- 目标内相对路径按配置文件所在目录解析
- 无参数执行全部目标；`--target <id>` 只执行一个；`--check` 校验全部目标
- 生成前整体预校验：`id` 缺失或重名、输入缺失或本地文件不存在、输出目录相同或互相嵌套，任一问题直接以退出码 2 结束且不写任何目标
- 某个目标运行期失败不中断其余目标，全部执行完后以退出码 1 结束并指出失败目标
- 存在 `targets` 时 `--config` 只接受单个配置文件，配置扫描与多选交互关闭
- 退出码：0 成功；1 生成 / 校验失败；2 用法或配置错误

## 分层配置（rc 文件，旧写法兼容）

团队需要本地层覆盖或多套预设时，继续使用嵌套写法：

| 层 | 文件 | 用途 |
| --- | --- | --- |
| 项目层 | `swagger2api.json` | 团队共享，随仓库提交 |
| 本地层 | `swagger2api.local.json` | 个人按项目覆盖，默认不入库 |
| 全局层 | `~/.swagger2api.json` | 个人跨项目偏好 |

查找方式为自工作目录向上找最近的配置文件；同目录新旧文件名并存时新名优先并告警。旧名 `.swagger2apirc.json`、`.swagger2apirc.local.json`、`~/.swagger2apirc.json` 继续可用，不做自动重命名。合并优先级为「命令行参数 > 环境变量 > 本地层 > 项目层 > 全局层 > 默认值」。

```json
{
  "input": { "url": "https://example.com/v3/api-docs" },
  "output": { "dir": "./src/api", "name": "index", "mode": "grouped" },
  "client": { "type": "axios" },
  "language": { "target": "ts" },
  "types": { "responses": true, "extractQuery": "arg0" },
  "naming": { "pathPrefixIndex": 0 },
  "profiles": { "admin": { "output": { "dir": "./src/api/admin" } } }
}
```

- 环境变量：`FX_S2A_INPUT`、`FX_S2A_OUTPUT`、`FX_S2A_NAME`、`FX_S2A_CLIENT`、`FX_S2A_LANGUAGE`、`FX_S2A_CLEAN`
- 类型检查：`output.typeCheck` 与扁平 `typeCheck` 同义，`skip`（默认）保留 `// @ts-nocheck`，`enforce` 在写盘后剥离
- 多套预设：`profiles` 内的命名预设用 `--profile <name>` 选用
- 排障：`swagger2api config status` 展示各层命中文件、生效字段与环境变量覆盖，`--json` 输出结构化结果
- 分组命名覆盖：`grouping.names` 以「原始组名 → 期望模块名」改写产物名，键可用原始名或折叠名（全半角、大小写不敏感），只改名不改接口归属；该表应写在项目层，本地层同名字段会整表替换项目层
- 合并同名组：`grouping.collapse` 为 `true` 时，折叠键相同的组（如 `opt` 与 `opt_`）合并为同一组，复现单文件产物「同名属性即同组」的语义；默认 `false` 时各自独立并追加序号
- 自适应分桶：`mode: "grouped"` 默认启用（`grouping.split` 未配置即为 `true`）。总量 ≤ `minRoutes`（默认 150）时只生成一个 `Modules` 模块文件；否则按命名空间码点顺序装箱，单桶达到 `targetRoutes`（默认 300）后开新桶；装箱后小于 `minBucketRoutes`（默认 60）的桶与相邻桶合并（优先前一桶且不超过 `maxRoutes`）；单个命名空间超过 `maxRoutes`（默认 450）时按子分类分片，尾片小于 `minBucketRoutes` 且与前一片合并后不超过 `maxRoutes` 时并入前一片，分片由门面类合并实例与类型；桶名取桶内首个命名空间，单桶固定 `Modules`。对外始终是 `api.<命名空间>.<方法>`
- `grouping.split` 三种形态：不配置即采用上述默认阈值；写对象可按需覆写 `minRoutes` / `targetRoutes` / `maxRoutes` / `minBucketRoutes` / `fallback`（默认 `misc`）/ `categories`，未写的项仍取默认；写 `false` 关闭自适应分桶，一个命名空间一个模块文件，仅作回滚逃生口。业务仓通常保持默认，确需固定文件数或调整桶大小时再覆写。离线产物可用 `swagger2api inspect --dir <目录>` 按同一判据审计（见 [CLI 参考](./cli)）
- 保留名：`index`、`types`、`client`、`shared` 等固定产物名，以及 `instance`、`request`、`setSecurityData` 等聚合成员名，命中后自动追加序号，避免覆盖生成能力或运行期成员
- 产物清理：`output.clean` 会清空整个输出目录（只适合纯生成目录）；分组模式默认按生成横幅清理，只删除带横幅且本轮不再生成的文件，手写适配文件不受影响；开关关闭时只报告多余产物、不删除；手动 `--modular` 同样按横幅清理已消失模块。横幅只读文件头前 1KB
- 多产物目录：同一目录需要多份配置时用 `swagger2api.<产物>.json`（如 `swagger2api.mg.json`）并以 `--config` 指定；单产物目录直接运行即可自动命中 `swagger2api.json`。同一输出目录只允许一份配置：同目录其他配置的输出与本配置相同或互相嵌套时以退出码 2 拒绝
- 旧配置：`saconfig.json` 仍可用；两套同时存在时 rc 优先，并给出迁移提示

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | string | - | Swagger JSON 文件路径或 URL，未配置时交互提示默认值 `https://example.com/v3/api-docs` |
| `output` | string | `'./src/api'` | 生成代码的输出目录，相对配置文件所在目录解析 |
| `name` | string | `'index'` | 接口文件名称，默认后缀为ts |
| `typeCheck` | `skip` / `enforce` | `'skip'` | 生成物是否保留 `// @ts-nocheck`；`enforce` 在写盘后剥离，`--check` 走同一处理 |
| `--check` | boolean | `false` | 生成到临时目录并与现有产物逐文件比对，不写真实目录；按缺失 / 不一致 / 多余三类报出，有差异时非 0 退出 |
| `--quick,-q` | boolean | `false` | 快速模式，直接使用配置文件参数，不再二次确认参数 |
| `--config,-c` | string | `'saconfig.json'` | 填写配置文件路径，支持多选，用【,】分隔 |
| `--config-all,-ca` | boolean | `false` | 加载全部配置文件，不进行选择 |
| `--config-scan,-cs` | boolean | `true` | 扫描全部配置文件，并提供选择列表 |
| `--replace-tags,-rt` | string[] | - | 替换标签，2个参数，第1个正则表达式（工具自动补^$头尾，整标签匹配），第2个替换字符串；值不足时忽略该参数并告警，保留原始标签 |
| `--convert-get,-cg` | boolean | `false` | 转换无{.+}get为query；仅转换末段为 get 且紧邻前缀非【}】的地址 |
| `--remove-param,-rp` | boolean | `false` | 移除{.+}参数 |
| `--remove-prefix-index,-rpi` | number | 未设置 | 移除前缀索引；传 `-1` 或不传均表示不移除 |
| `--remove-dts,-rd` | boolean | `false` | 移除使用--js参数时生成的d.ts文件 |
| `--prune-output` | boolean | 分组模式默认开启 | 按生成横幅清理已消失的产物，只读文件头前 1KB，不触碰手写文件；关闭时只报告不删除 |
| `--remove-empty-components,-rec` | boolean | `true` | 移除空组件定义 |
| `--extract-request-query,-erq` | string | - | 提取参数，将query参数中的指定对象字段提取为根部字段，支持多选，用【,】分隔，每个接口只提取第一次命中的字段 |
| `--extract-response-raw,-err` | boolean | `false` | 提取响应，将AxiosResponse返回值转移到raw字段，根部字段自行定义，使用该参数需在响应拦截中重新设计实际的返回值。仅 axios 客户端生效，需搭配 `--axios` 参数，详见[完整攻略 · 提取响应](./guide#提取响应--extract-response-raw-err) |

> 布尔类型的选项均支持显式传 `false` 关闭，如用 `--config-scan false` 关闭默认开启的配置扫描。选项与值需空格分隔，写作 `--config-scan,false` 连写形式不会被识别。

## 相关页面

- 参考：[CLI 参考](./cli) · [完整攻略](./guide) · [常见问题](./faq)
