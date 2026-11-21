import fs from "node:fs"
import url from "node:url"
import path from "node:path"
/** 数据集合 */
const datas = {
  /** 参数 */
  param: process.argv.filter((_item, index) => index > 1)
}
/**
 * 获取参数
 * @param name 参数名称
 * @param type 类型，key:键名、布尔型，value:键值，array:数组
 * @param param 参数
 * @return 选中的参数
 */
export function getParam(name: string | string[], type = "value" as "key" | "value" | "array", param: Record<string, any> = {}) {
  // 处理名称
  if (!Array.isArray(name)) name = [name]
  // 配置数据
  let data: boolean | string | string[]
  // 查询参数
  datas.param.forEach((item, index) => {
    // 查询索引
    if (!name.includes(item)) {
      // 空值
      return
    } else if (["value"].includes(type)) {
      // 取键值
      data = datas.param[index + 1]
    } else if (["array"].includes(type)) {
      // 取数组
      data = Array.from({ length: param.length ?? 1 }).map((_item2, index2) => datas.param[index + index2 + 1])
    } else {
      // 取键名
      data = !["false"].includes(datas.param[index + 1])
    }
  })
  // 返回参数
  return data
}
/**
 * 获取参数键名
 * @param name 参数名称
 * @return 选中的参数
 */
export function getPKey(name: string | string[]) {
  return getParam(name, "key") as boolean
}
/**
 * 获取参数键值
 * @param name 参数名称
 * @return 选中的参数
 */
export function getPValue(name: string | string[]) {
  return getParam(name, "value") as string
}
/**
 * 获取参数数组
 * @param name 参数名称
 * @param param 参数
 * @return 选中的参数
 */
export function getPArray(name: string | string[], param: Record<string, any> = {}) {
  return (getParam(name, "array", param) ?? []) as string[]
}
/**
 * 保存文件
 * @param file 文件地址
 * @param data 数据
 * @return 无返回数据
 */
export function saveFile(file, data) {
  // 获取目录
  const dir = path.dirname(file)
  // 创建目录
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  // 写入文件
  fs.writeFileSync(file, data)
}
/** 获取当前文件 */
export function getFilename() {
  return typeof require !== "undefined" && typeof module !== "undefined" ? __filename : url.fileURLToPath(import.meta.url)
}
/** 获取当前目录 */
export function getDirname() {
  return typeof require !== "undefined" && typeof module !== "undefined" ? __dirname : path.dirname(getFilename())
}
/** 工具版本缓存 */
let toolVersion: string | null = null
/** 诊断类命令 JSON 的格式版本：字段结构变化时递增 */
export const DIAGNOSTIC_SCHEMA_VERSION = 1
/**
 * 读取工具版本：从模块所在目录向上查找包根 package.json。
 * @return 版本号；未找到返回空串
 */
export function readToolVersion() {
  if (toolVersion !== null) return toolVersion
  toolVersion = ""
  let dir = getDirname()
  for (;;) {
    const file = path.join(dir, "package.json")
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
        if (parsed.name === "@fxri/swagger2api" && typeof parsed.version === "string") {
          toolVersion = parsed.version
          break
        }
      } catch {
        // 非法 JSON 视为非目标包，继续向上
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return toolVersion
}
/**
 * 输出结构化 JSON：固定写 stdout，不受 JSON 模式下人类日志重定向影响。
 * @param payload 可序列化对象
 * @return 无
 */
export function writeJson(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}
/**
 * 扫描配置文件（替代 glob 的 `./**\/saconfig*.json`）
 * 语义对齐 glob 默认值：包含根目录、跳过 node_modules 与点开头目录、结果按字典序排序
 * @param dir 扫描根目录，默认当前工作目录
 * @return 相对扫描根目录的配置文件路径
 */
export function scanConfigFiles(dir = process.cwd()) {
  const files: string[] = []
  /** 递归遍历目录 */
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      // 跳过点开头目录与文件，对齐 glob 的 dot: false
      if (entry.name.startsWith(".")) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        // 跳过依赖目录，对齐原 ignore 选项
        if (entry.name === "node_modules") continue
        walk(full)
      } else if (entry.isFile() && entry.name.startsWith("saconfig") && entry.name.endsWith(".json")) {
        files.push(path.relative(dir, full))
      }
    }
  }
  walk(dir)
  // 排序保证交互式选择顺序与 glob 一致
  return files.sort()
}
