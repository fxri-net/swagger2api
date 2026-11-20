import axios from "axios"
import { execSync } from "node:child_process"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import prompts from "prompts"
import { generateApi } from "swagger-typescript-api"
import { Defines, getDirname, getPArray, getPKey, getPValue, isUrl, saveFile, scanConfigFiles } from "./utils"
import { guardSpec } from "./utils/security/spec-guard"
import { applyEnvOverrides, applyProfile, getConfigFlags, loadConfigLayers } from "./utils/config"
/** 配置集合 */
const confs = {
  /** 文件集合 */
  files: [],
  /** 参数 */
  param: {} as { url?: string; output?: string; name?: string }
} as Defines["confs"]
/** 数据集合 */
const datas = {
  /** 用户目录 */
  home: os.homedir(),
  /** 枚举 */
  enum: {} as { [key: string]: number }
} as Defines["datas"]
/** 生成失败的文档数量 */
let failures = 0
/** 退出 */
function onExit(message?: string, code = 0) {
  message && console.log(message)
  process.exit(code)
}
/** 加载参数 */
async function onLoadParam() {
  /** 参数 */
  datas.param = {
    config: getPValue(["--config", "-c"]),
    configScan: getPKey(["--config-scan", "-cs"]) ?? true,
    configAll: getPKey(["--config-all", "-ca"]),
    quick: getPKey(["--quick", "-q"]),
    replaceTags: getPArray(["--replace-tags", "-rt"], { length: 2 }),
    convertGet: getPKey(["--convert-get", "-cg"]),
    removeParam: getPKey(["--remove-param", "-rp"]),
    removePrefixIndex: getPValue(["--remove-prefix-index", "-rpi"]),
    removeDts: getPKey(["--remove-dts", "-rd"]),
    removeEmptyComponents: getPKey(["--remove-empty-components", "-rec"]) ?? true,
    extractRequestQuery: getPValue(["--extract-request-query", "-erq"]),
    extractResponseRaw: getPKey(["--extract-response-raw", "-err"]),
    template: path.resolve(getDirname(), "./templates")
  }
  /** 配置 */
  datas.config = {
    templates: getPValue(["--templates", "-t"]) ?? datas.param.template, // 路径到包含模板的文件夹
    defaultResponseAsSuccess: getPKey(["--default-as-success", "-d"]), // 将“默认”响应状态码也用作成功响应
    generateResponses: getPKey(["--responses", "-r"]), // 生成有关请求响应的附加信息
    generateUnionEnums: getPKey("--union-enums"), // 生成所有“枚举”类型为联合类型 (T1 | T2 | TN)
    addReadonly: getPKey("--add-readonly"), // 生成只读属性
    generateRouteTypes: getPKey("--route-types"), // 生成 API 路由的类型定义
    generateClient: !getPKey("--no-client"), // 不要生成API类
    enumNamesAsValues: getPKey("--enum-names-as-values"), // 使用'x-enumNames'中的值作为枚举值（而不仅仅是作为键）
    extractRequestParams: getPKey("--extract-request-params"), // 提取请求参数到数据合同
    extractRequestBody: getPKey("--extract-request-body"), // 将请求体类型提取到数据契约
    extractResponseBody: getPKey("--extract-response-body"), // 将响应体类型提取到数据契约
    extractResponseError: getPKey("--extract-response-error"), // 提取响应错误类型到数据合同
    modular: getPKey("--modular"), // 生成http客户端、数据契约和路由的分离文件
    toJS: getPKey("--js"), // 生成带有声明文件的js api模块
    moduleNameIndex: Number(getPValue("--module-name-index") ?? 0), // 确定用于路由分离的路径索引
    moduleNameFirstTag: getPKey("--module-name-first-tag"), // 根据第一个标签拆分路线
    httpClientType: getPKey("--axios") ? "axios" : "fetch", // 生成 axios http 客户端
    unwrapResponseData: getPKey("--unwrap-response-data"), // 从响应中提取数据项
    disableThrowOnError: getPKey("--disable-throw-on-error"), // 当 response.ok 不为真时，不要抛出错误（默认：false）
    singleHttpClient: getPKey("--single-http-client"), // 能够将HttpClient实例传递给Api构造函数（默认：false）
    silent: getPKey("--silent") ?? true, // 仅将错误输出到控制台
    defaultResponseType: getPValue("--default-response") ?? "void", // 默认类型为无响应模式
    typePrefix: getPValue("--type-prefix") ?? "", // 数据合同名称前缀
    typeSuffix: getPValue("--type-suffix") ?? "", // 数据合同名称后缀
    cleanOutput: getPKey("--clean-output"), // 在生成API之前清理输出文件夹。 警告：可能会导致数据丢失（默认：false）
    ...(getPValue("--api-class-name") ? { apiClassName: getPValue("--api-class-name") } : {}), // API类名
    patch: getPKey("--patch"), // 修正Swagger源定义中的小错误（默认：false）
    debug: getPKey("--debug"), // 此工具内进程的附加信息（默认：false）
    anotherArrayType: getPKey("--another-array-type"), // 生成数组类型为 Array<Type>（默认为 Type[]）（默认：false）
    sortTypes: getPKey("--sort-types"), // 排序字段和类型（默认：false）
    extractEnums: getPKey("--extract-enums") // 从内联接口提取所有枚举类型 将内容提取到 typescript 枚举构造中（默认：false）
  } as Parameters<typeof generateApi>["0"]
  // 应用 rc 配置（命令行显式参数优先）
  onApplyRc()
}
/**
 * 判断命令行是否显式给出某个开关
 * @param names 参数名（含短名）
 * @return 是否出现
 */
function hasFlag(names: string[]) {
  const argv = process.argv.slice(2)
  return names.some((name) => argv.includes(name))
}
/**
 * 应用 rc 配置：仅在命令行未显式给出时回落到配置值
 * @return 无
 */
function onApplyRc() {
  const flags = getConfigFlags()
  const layers = loadConfigLayers(process.cwd(), { projectFile: flags.configFile })
  layers.warnings.forEach((warning) => console.error("⚠️", warning))
  const rc = applyEnvOverrides(applyProfile(layers.merged, flags.profile))
  const input = rc.input ?? {}
  const output = rc.output ?? {}
  const types = rc.types ?? {}
  const naming = rc.naming ?? {}
  const grouping = rc.grouping ?? {}
  const rcUrl = input.url ?? input.file
  if (!rcUrl) return
  // rc 提供输入地址即视为配置驱动：不扫描、不回写 saconfig
  datas.rcDriven = true
  datas.rcUrl = rcUrl
  datas.rcOutput = output.dir ?? "./src/api"
  datas.rcName = output.name ?? "index"
  const param = datas.param
  param.quick = true
  if (!hasFlag(["--remove-prefix-index", "-rpi"]) && naming.pathPrefixIndex !== undefined) param.removePrefixIndex = String(naming.pathPrefixIndex)
  if (!hasFlag(["--convert-get", "-cg"]) && naming.convertGetToQuery !== undefined) param.convertGet = naming.convertGetToQuery
  if (!hasFlag(["--remove-param", "-rp"]) && naming.dropPathParams !== undefined) param.removeParam = naming.dropPathParams
  if (!hasFlag(["--extract-request-query", "-erq"]) && types.extractQuery !== undefined) param.extractRequestQuery = types.extractQuery
  if (!hasFlag(["--remove-dts", "-rd"]) && types.removeDts !== undefined) param.removeDts = types.removeDts
  if (!hasFlag(["--replace-tags", "-rt"]) && naming.tagRewrite) param.replaceTags = naming.tagRewrite
  const config = datas.config as Record<string, any>
  if (!hasFlag(["--axios"]) && rc.client?.type) config.httpClientType = rc.client.type === "axios" ? "axios" : "fetch"
  if (!hasFlag(["--js"]) && rc.language?.target) config.toJS = rc.language.target === "js"
  if (!hasFlag(["--responses", "-r"]) && types.responses !== undefined) config.generateResponses = Boolean(types.responses)
  if (!hasFlag(["--unwrap-response-data"]) && types.unwrapData !== undefined) config.unwrapResponseData = Boolean(types.unwrapData)
  if (!hasFlag(["--extract-request-params"]) && types.extractParams !== undefined) config.extractRequestParams = Boolean(types.extractParams)
  if (!hasFlag(["--clean-output"]) && output.clean !== undefined) config.cleanOutput = Boolean(output.clean)
  if (!hasFlag(["--modular"]) && output.mode === "grouped") config.modular = true
  if (!hasFlag(["--module-name-index"]) && grouping.pathDepth !== undefined) config.moduleNameIndex = Number(grouping.pathDepth)
  if (Object.keys(grouping).length) config.grouping = grouping
}
/** 加载配置 */
async function onLoadConfig() {
  // rc 配置驱动时不需要扫描 saconfig
  if (datas.rcDriven) {
    confs.files = ["(swagger2apirc)"]
    return
  }
  // 疏理文件
  if (datas.param.config) {
    // 指定配置文件
    confs.files = datas.param.config.split(",")
  } else if (datas.param.configScan) {
    // 扫描配置文件
    confs.files = scanConfigFiles()
  }
  // 默认文件
  if (confs.files.length == 0) confs.files = ["saconfig.json"]
  // 选择文件
  if (!datas.param.configAll && confs.files.length > 1) {
    confs.files = (
      await prompts({
        type: "multiselect",
        name: "files",
        message: "选择配置文件",
        hint: "可多选，空格键勾选，回车完成",
        choices: confs.files.map((item) => ({ title: item.replace(/\\/g, "/"), value: item }))
      }).then((res) => (res.files?.length != 0 ? res : onExit("结束：至少选择一个配置文件")))
    )["files"]
  }
  // 检查配置
  if (!(confs.files?.length > 0)) onExit("结束：手动退出")
}
/** 输入参数 */
async function onInputParam() {
  // rc 配置驱动：直接使用配置值，不读 saconfig、不交互
  if (datas.rcDriven) {
    confs.param = { url: datas.rcUrl, output: datas.rcOutput, name: datas.rcName }
    datas.docFile = path.resolve(`${datas.rcOutput}/${datas.rcName}-${new Date().getTime()}.json`)
    return
  }
  try {
    // 初始化配置
    confs.param = {}
    // 读取配置文件
    confs.param = JSON.parse(fs.readFileSync(confs.file, "utf-8"))
  } catch (error) {}
  // 检查快速模式
  if (!datas.param.quick || [confs.param.url, confs.param.output, confs.param.name].includes(undefined)) {
    // 输入配置
    confs.param = await prompts([
      { name: "url", type: "text", message: "Swagger docs 地址:", initial: confs.param.url ?? "https://example.com/v3/api-docs" },
      { name: "output", type: "text", message: "输出地址:", initial: confs.param.output ?? "./src/api" },
      { name: "name", type: "text", message: "文件名:", initial: confs.param.name ?? "index" }
    ])
  }
  // 检查配置
  if ([confs.param.url, confs.param.output, confs.param.name].includes(undefined)) onExit("结束：手动退出")
  // 疏理文档
  datas.docFile = path.resolve(`${confs.param.output}/${confs.param.name}-${new Date().getTime()}.json`)
}
/** 加载文档 */
async function onLoadDoc(index = 0) {
  // 疏理文件
  confs.file = confs.files[index]
  // 输入配置
  await onInputParam()
  // 检查地址
  if (isUrl(confs.param.url)) {
    // 请求文档
    await axios
      .get(confs.param.url)
      .then((res) => onGenerateApi(res.data))
      .catch((err) => console.log("失败：", err))
  } else {
    try {
      // 读取文档
      await onGenerateApi(JSON.parse(fs.readFileSync(path.resolve(confs.param.url), "utf8")))
    } catch (error) {
      console.log("失败：", error)
    }
  }
  // 加载下一个文档
  if (confs.files[index + 1]) {
    await onLoadDoc(index + 1)
  } else if (failures > 0) {
    // 批量场景下跳过不合规文档，但整体以非 0 退出，避免静默降级
    onExit(`结束：${failures} 个文档因安全问题未生成`, 1)
  }
}
/** 生成接口 */
async function onGenerateApi(data: Defines["data"]) {
  // 检查格式
  if (typeof data?.paths != "object") return console.log("失败：缺少paths字段")
  // 安全守卫：解析外部引用、转义代码字面量、校验标识符字段
  const guard = await guardSpec(data, { baseUrl: isUrl(confs.param.url) ? confs.param.url : undefined })
  if (guard.errors.length > 0) {
    guard.errors.forEach((error) => console.error("失败：", error))
    failures += 1
    return
  }
  // 处理路径
  Object.entries(data.paths).forEach((item) => {
    Object.keys(item[1]).forEach((item2) => {
      // 配置标签
      if (datas.param.replaceTags.length) {
        // 替换标签
        data.paths[item[0]][item2].tags = data.paths[item[0]][item2].tags?.map((item) =>
          item.replace(new RegExp(`^${datas.param.replaceTags[0]}$`, "g"), datas.param.replaceTags[1] ?? "")
        )
      }
      // 配置操作id
      let id = `${item[0]}/${item2}`
      // 转换无{.+}get为query
      if (datas.param.convertGet) {
        id = id.replace(/([^\}]\/)get$/g, "$1query")
      }
      // 移除参数
      if (datas.param.removeParam) {
        id = id.replace(/\/\{.+?\}/g, "")
      }
      // 移除前缀索引
      if (datas.param.removePrefixIndex) {
        let ids = id.split("/")
        ids = ids.slice(0, 1).concat(ids.slice(Number(datas.param.removePrefixIndex) + 2))
        id = ids.join("/")
      }
      // 操作id会作为路由名写入代码，剔除可闭合字面量的字符
      id = id.replace(/["\\`\r\n]/g, "_").replace(/\$\{/g, "_")
      // 配置操作id
      data.paths[item[0]][item2].operationId = id
      // 统计请求方式
      const method = id.split("/").slice(-1)[0]
      typeof datas.enum[method] == "number" ? datas.enum[method]++ : (datas.enum[method] = 1)
    })
  })
  // 处理组件
  Object.entries(data.components).forEach((item) => {
    Object.keys(item[1]).forEach((item2) => {
      // 移除空组件定义
      if (datas.param.removeEmptyComponents && !Object.keys(data.components[item[0]][item2]).length) {
        delete data.components[item[0]][item2]
      }
    })
  })
  console.log("就绪：", ...Object.entries(datas.enum).map((item) => item.join("-")))
  // 保存文档
  saveFile(datas.docFile, JSON.stringify(data))
  // 生成接口
  console.log("执行：", confs.file)
  await generateApi({
    fileName: `${confs.param.name}.ts`, // 输出类型的 API 文件名称（默认："Api.ts"）
    output: path.resolve(confs.param.output), // TypeScript API 文件的输出路径（默认："./"）
    input: datas.docFile, // 路径/链接到Swagger方案
    ...datas.config,
    ...{ param: datas.param }
  })
  console.log("完成：", path.resolve(confs.param.output, `${confs.param.name}${!datas.config.toJS ? ".ts" : ".js"}`))
  if (datas.config.toJS) {
    console.log("完成：", path.resolve(confs.param.output, `${confs.param.name}.d.ts`))
  }
  // 删除文档
  fs.unlinkSync(datas.docFile)
  // 移除使用--js参数时生成的d.ts文件
  if (datas.param.removeDts) {
    console.log("清理：", path.resolve(confs.param.output, `${confs.param.name}.d.ts`))
    execSync(`npx rimraf ${path.resolve(confs.param.output, `${confs.param.name}.d.ts`)}`, { cwd: datas.home }).toString()
  }
  // 保存配置（rc 驱动时不回写 saconfig）
  if (!datas.rcDriven) saveFile(confs.file, JSON.stringify(confs.param, null, 2))
}
/** 主线 */
async function onMain() {
  // 加载参数
  await onLoadParam()
  // 加载配置
  await onLoadConfig()
  // 加载文档
  onLoadDoc()
}
// 导出方法
export { onMain as generateApi }
