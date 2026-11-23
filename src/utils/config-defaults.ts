import { DEFAULT_FETCH_TIMEOUT } from "./common"

// 配置默认值真源：运行期读取与写盘剔除共用同一份常量，避免文档与实现漂移。
// 只登记「不配置与显式写默认值行为等价」的键；naming / types / grouping 不在其中。

/** 稳定默认值 */
export const CONFIG_DEFAULTS = {
  /** HTTP 客户端：不配置时按 fetch 生成 */
  client: "fetch" as const,
  /** 输出语言：不配置时按 ts 生成 */
  language: "ts" as const,
  /** 输出段 */
  output: {
    /** 入口文件名 */
    name: "index" as const,
    /** 单文件模式 */
    mode: "single" as const,
    /** 保留 @ts-nocheck */
    typeCheck: "skip" as const,
    /** 中文横幅 */
    banner: "zh" as const
  },
  /** 输入段 */
  input: {
    /** 拉取超时：0 表示不超时 */
    timeout: DEFAULT_FETCH_TIMEOUT
  }
}
