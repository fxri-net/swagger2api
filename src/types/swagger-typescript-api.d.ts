/**
 * swagger-typescript-api 的最小类型声明。
 * 该版本（13.0.28）不随包提供声明文件，这里只声明本工具实际使用的入口与参数形态，
 * 避免 `generateApi` 被推断为 any 而失去参数约束。
 */
declare module "swagger-typescript-api" {
  /** 生成参数（仅覆盖本工具传入的字段） */
  interface GenerateApiParams {
    /** 输出文件名 */
    fileName?: string
    /** 输出目录 */
    output?: string | false
    /** 文档路径或地址 */
    input?: string
    /** 文档对象 */
    spec?: unknown
    /** 模板目录 */
    templates?: string
    /** 是否生成 axios 客户端 */
    axios?: boolean
    /** 是否生成响应信息 */
    generateResponses?: boolean
    /** 是否按模块拆分 */
    modular?: boolean
    /** 模块名取路径的索引 */
    moduleNameIndex?: number
    /** 是否输出 JS */
    toJS?: boolean
    /** 其他参数 */
    [key: string]: any
  }

  /** 生成结果 */
  interface GenerateApiResult {
    /** 产物文件列表 */
    files?: Array<{ name?: string; content?: string }>
    /** 生成配置 */
    configuration?: any
  }

  /**
   * 生成 API 客户端
   * @param params 生成参数
   * @return 生成结果
   */
  export function generateApi(params: GenerateApiParams): Promise<GenerateApiResult>
}
