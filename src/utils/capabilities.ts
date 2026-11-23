// 能力清单：命令注册表是 CLI 帮助、docs 能力总览与技能能力地图的唯一真源。
// 命令名与能力 ID 属于稳定契约，改名须保留别名；verify 的漂移门禁据此校验三处视图一致。

/** 命令能力 */
export interface CommandCapability {
  /** 稳定能力 ID：跨版本不变，AI 据此选择命令 */
  id: string
  /** 命令用法（可执行文件短名，不含占位参数） */
  name: string
  /** 解决什么问题 */
  purpose: string
  /** 是否只读（不写文件、不改状态） */
  readOnly: boolean
  /** 是否破坏性（会删除文件，需要人工确认） */
  destructive: boolean
  /** 关键参数 */
  params: string[]
  /** 可直接复制的示例；首条用于冒烟 */
  examples: string[]
  /** 建议的下一步（能力 ID 或说明） */
  next: string
}

/** 配置项能力 */
export interface ConfigKeyCapability {
  /** 配置键（点号路径） */
  key: string
  /** 类型 */
  type: string
  /** 默认值 */
  default: string
  /** 枚举取值（可选） */
  values?: string[]
  /** 适用场景 */
  usage: string
}

/** 技能参考文件索引 */
export interface SkillReference {
  /** 文件名（references 目录内） */
  file: string
  /** 用途 */
  purpose: string
}

/** 命令注册表：单一真源 */
export const COMMAND_CAPABILITIES: CommandCapability[] = [
  {
    id: "generate",
    name: "swagger2api",
    purpose: "按配置生成文档产物；单文档直接执行，多文档交互勾选或 --target / --all",
    readOnly: false,
    destructive: false,
    params: ["--config <文件>", "--target <id[,id]>", "--all", "--profile <name>", "--timeout <ms>", "--no-interactive"],
    examples: ["swagger2api --config swagger2api.json", "swagger2api --config swagger2api.json --target lc"],
    next: "check"
  },
  {
    id: "preview",
    name: "swagger2api --dry-run",
    purpose: "只输出分组报表：命名映射、桶与分片规划、预计新增文件，不写产物",
    readOnly: true,
    destructive: false,
    params: ["--json", "--config <文件>"],
    examples: ["swagger2api --dry-run --json"],
    next: "generate"
  },
  {
    id: "check",
    name: "swagger2api --check",
    purpose: "生成到临时目录与现有产物比对，按缺失 / 不一致 / 多余报出，不写真实目录",
    readOnly: true,
    destructive: false,
    params: ["--json", "--config <文件>", "--target <id>"],
    examples: ["swagger2api --check", "swagger2api --check --json"],
    next: "prune"
  },
  {
    id: "init",
    name: "swagger2api init",
    purpose: "交互式生成 swagger2api.json（--from-script 为 upgrade --yes 的兼容别名）",
    readOnly: false,
    destructive: false,
    params: ["--from-script <package.json>", "--config <文件>"],
    examples: ["swagger2api init", "swagger2api init --from-script package.json"],
    next: "generate"
  },
  {
    id: "upgrade",
    name: "swagger2api upgrade",
    purpose: "迁移旧配置到 base + docs，按命令值收敛直连脚本参数并保留脚本，备份后改写 package.json，支持回退",
    readOnly: false,
    destructive: false,
    params: ["--dry-run", "--diff", "--check", "--yes", "--only <目录>", "--skip <目录>", "--cwd <目录>", "--json", "--keep-legacy", "--restore <latest|目录>"],
    examples: ["swagger2api upgrade --dry-run", "swagger2api upgrade --diff", "swagger2api upgrade --restore latest"],
    next: "generate"
  },
  {
    id: "grouping",
    name: "swagger2api grouping",
    purpose: "展示标签与路径分布，交互式写入指定文档的分组配置",
    readOnly: false,
    destructive: false,
    params: ["--target <id>", "--config <文件>"],
    examples: ["swagger2api grouping --target base"],
    next: "preview"
  },
  {
    id: "config-status",
    name: "swagger2api config status",
    purpose: "展示配置分层、环境变量覆盖与生效结果，用于配置排障",
    readOnly: true,
    destructive: false,
    params: ["--json", "--config <文件>", "--profile <name>"],
    examples: ["swagger2api config status", "swagger2api config status --json"],
    next: "generate"
  },
  {
    id: "surface",
    name: "swagger2api surface",
    purpose: "提取产物接口面、写基线或与基线比对，用于跨版本迁移与回归",
    readOnly: false,
    destructive: false,
    params: ["--out <文件>", "--compare <文件>", "--requests-only", "--json", "--target <id[,id]>"],
    examples: ["swagger2api surface --out .swagger2api/surface.json", "swagger2api surface --compare .swagger2api/surface.json"],
    next: "check"
  },
  {
    id: "inspect",
    name: "swagger2api inspect",
    purpose: "只读审计产物布局：模块体量、分片余量、固定产物与小文件",
    readOnly: true,
    destructive: false,
    params: ["--dir <目录>", "--json", "--strict", "--config <文件>"],
    examples: ["swagger2api inspect --dir ./src/api/base", "swagger2api inspect --dir ./src/api/base --json"],
    next: "preview"
  },
  {
    id: "prune",
    name: "swagger2api prune",
    purpose: "清理废弃产物目录中带生成横幅的文件，默认只列、--yes 才删",
    readOnly: false,
    destructive: true,
    params: ["--dir <目录>", "--yes", "--json"],
    examples: ["swagger2api prune --dir ./src/api/old --json", "swagger2api prune --dir ./src/api/old --yes"],
    next: "check"
  },
  {
    id: "skill",
    name: "swagger2api skill",
    purpose: "定位包内 AI 技能入口，输出全文或结构化定位与参考索引",
    readOnly: true,
    destructive: false,
    params: ["--print", "--json"],
    examples: ["swagger2api skill --json", "swagger2api skill --print"],
    next: "capabilities"
  },
  {
    id: "capabilities",
    name: "swagger2api capabilities",
    purpose: "输出能力清单：命令、配置项、退出码与技能参考索引",
    readOnly: true,
    destructive: false,
    params: ["--json"],
    examples: ["swagger2api capabilities --json"],
    next: "generate"
  },
  {
    id: "version",
    name: "swagger2api --version",
    purpose: "输出版本号（纯文本一行），用于日志记录与复现",
    readOnly: true,
    destructive: false,
    params: [],
    examples: ["swagger2api --version"],
    next: "capabilities"
  }
]

/** 配置项注册表：只列需要判断的键，细节以 docs/config.md 为准 */
export const CONFIG_KEYS: ConfigKeyCapability[] = [
  { key: "docs[].id", type: "string", default: "-", usage: "文档唯一标识，用于 --target 与本地层覆盖" },
  { key: "docs[].source", type: "string | object", default: "-", usage: "文档地址 / 本地文件，或 { url | file, headers, timeout }" },
  { key: "docs[].output", type: "string | object", default: "./src/api", usage: "产物目录，可为字符串或 { dir, name, ... }" },
  { key: "base.output.name", type: "string", default: "index", usage: "入口文件名默认值，文档项可覆盖" },
  { key: "base.output.mode", type: "string", default: "single", values: ["single", "grouped"], usage: "单文件或分组多文件" },
  { key: "base.output.prune", type: "boolean", default: "分组模式开启", usage: "生成后按横幅清理旧产物" },
  { key: "base.output.clean", type: "boolean", default: "false", usage: "生成前清空整个输出目录，仅适合纯生成目录" },
  { key: "base.output.typeCheck", type: "string", default: "skip", values: ["skip", "enforce"], usage: "是否剥离生成物的 @ts-nocheck" },
  { key: "base.output.banner", type: "string", default: "zh", values: ["zh", "en"], usage: "产物文件头横幅语言" },
  { key: "base.client", type: "string", default: "fetch", values: ["fetch", "axios"], usage: "HTTP 客户端" },
  { key: "base.language", type: "string", default: "ts", values: ["ts", "js"], usage: "产物语言，JS 同时生成声明" },
  { key: "base.types.responses", type: "boolean", default: "false", usage: "生成响应类型信息" },
  { key: "base.grouping.split", type: "boolean | object", default: "true", usage: "自适应分桶与分片阈值" },
  { key: "base.grouping.names", type: "object", default: "{}", usage: "原始组名到模块名的覆盖表" }
]

/** 退出码 */
export const EXIT_CODES = [
  { code: 0, description: "成功：生成完成、校验通过或预览完成" },
  { code: 1, description: "生成或校验失败：拉取失败、产物缺失 / 不一致 / 多余" },
  { code: 2, description: "用法或配置错误：缺参、目录不存在、目录不安全、多文档未显式选择" }
]

/** 技能参考文件索引：与 references 目录一一对应 */
export const SKILL_REFERENCES: SkillReference[] = [
  { file: "cli.md", purpose: "CLI 参数、诊断 JSON 契约与退出码" },
  { file: "config.md", purpose: "配置决策项、多目标与分层" },
  { file: "output.md", purpose: "产物结构、横幅归属与验收" },
  { file: "troubleshooting.md", purpose: "症状 → 命令排障与典型失败输出" },
  { file: "migration.md", purpose: "旧脚本与旧配置迁移" },
  { file: "recipes.md", purpose: "首次接入、多目标、离线迁移与 CI 接入配方" },
  { file: "capabilities.md", purpose: "逐命令用途、参数、模式与示例" }
]
