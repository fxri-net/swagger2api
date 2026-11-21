import { generateApi } from "swagger-typescript-api"
import type { TargetConfig } from "./targets"
/** 生成配置集合 */
export type GenerateConfig = Parameters<typeof generateApi>["0"]
/** 命令行参数集合 */
export interface ParamData {
  /** 指定配置文件 */
  config: string
  /** 扫描全部配置文件 */
  configScan: boolean
  /** 加载全部配置文件 */
  configAll: boolean
  /** 快速模式 */
  quick: boolean
  /** 替换标签 */
  replaceTags: string[]
  /** 转换无{.+}get为query */
  convertGet: boolean
  /** 移除{.+}参数 */
  removeParam: boolean
  /** 移除前缀索引 */
  removePrefixIndex: string
  /** 移除使用--js参数时生成的d.ts文件 */
  removeDts: boolean
  /** 移除空组件定义 */
  removeEmptyComponents: boolean
  /** 提取参数，将query参数中的指定对象字段提取为根部字段，只提取第一次命中的字段 */
  extractRequestQuery: string
  /** 提取响应，将AxiosResponse返回值转移到raw字段，根部字段自己定义 */
  extractResponseRaw: boolean
  /** 模板路径 */
  template: string
  /** 分组前原始标签映射（键为「方法:路径」），用于 JSDoc 展示 */
  groupOriginalTags?: Record<string, string>
  /** 分组模式模块类名映射（键为模块名），供模板与聚合入口同源取名 */
  moduleClassNames?: Record<string, string>
  /** 分桶文件布局（键为桶模块名），供模板在同一个文件里渲染多个命名空间类 */
  splitBuckets?: Record<string, Array<{ tag: string; className: string; title: string; routes: number }>>
}
/** 定义集合 */
export type Defines = {
  /** 配置集合 */
  confs: {
    /** 文件集合 */
    files: string[]
    /** 文件 */
    file: string
    /** 参数 */
    param: { url?: string; output?: string; name?: string }
  }
  /** 数据集合 */
  datas: {
    /** 用户目录 */
    home: string
    /** 文档 */
    docFile: string
    /** 配置 */
    config: GenerateConfig
    /** 参数 */
    param: ParamData
    /** 枚举 */
    enum: { [key: string]: number }
    /** 配置目录（目标内相对路径的解析基准） */
    configDir?: string
    /** 是否由 rc 配置驱动（不读写 saconfig） */
    rcDriven?: boolean
    /** rc 提供的文档地址 */
    rcUrl?: string
    /** rc 提供的输出目录 */
    rcOutput?: string
    /** rc 提供的入口文件名 */
    rcName?: string
    /** 命令行覆盖前的参数快照（多目标逐目标复位） */
    baseParam?: ParamData
    /** 命令行覆盖前的生成配置快照（多目标逐目标复位） */
    baseConfig?: GenerateConfig
    /** 是否多目标模式 */
    targetMode?: boolean
    /** 本次要执行的目标（--target 过滤后） */
    targets?: TargetConfig[]
    /** 当前执行的目标 id */
    currentTarget?: string
    /** 当前目标的分组报表（dry-run --json 汇总用） */
    groupReports?: Array<{ id: string; report: Record<string, any> }>
  }
  /** 数据 */
  data: {
    /** 路径 */
    paths: Record<string, Record<string, any>>
    /** 组件 */
    components: Record<string, Record<string, any>>
  }
}
