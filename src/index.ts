import axios from "axios"
import { execSync } from "node:child_process"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { generateApi } from "swagger-typescript-api"
import { Defines, DEFAULT_FETCH_TIMEOUT, DIAGNOSTIC_SCHEMA_VERSION, canPrompt, getDirname, getPArray, getPKey, getPValue, isUrl, normalizeTimeout, readToolVersion, saveFile, writeJson } from "./utils"
import { guardSpec } from "./utils/security/spec-guard"
import { getConfigFlags, loadConfigLayers } from "./utils/config"
import { hasDocs, pickDocFlags, resolveDocs, selectDocs } from "./utils/docs"
import { PromptCancelled, askCheckbox } from "./utils/cli-ui"
import { stripTsNoCheck } from "./utils/postprocess"
import {
  buildCollisionExports,
  collectGeneratedFiles,
  collectGeneratedFilesOf,
  findHandwrittenConflicts,
  findStaleOutputFiles,
  pascalCase,
  pruneGeneratedOutput,
  removeLegacyOutput,
  removeNewOutputFiles,
  snapshotOutputFiles,
  toModuleEntries,
  verifyGroupedOutput,
  writeAggregateEntry,
  writeSplitFacades
} from "./utils/modular"
import { resolveBannerLanguage, rewriteGeneratedBanners } from "./utils/banner"
import { inspectLayout, inspectThresholdsOf } from "./utils/inspect"
import { applyGrouping, type GroupingConfig, type SplitPlan } from "./utils/grouping"
import { splitContractOutput } from "./utils/contracts"
import { normalizeSpecShape } from "./utils/spec-shape"
import { CLIENT_BASE, TYPES_DIR, findOrphanModules, isReservedProperty, slugifyGroupName, toClassName, toClassNames, toNamespaceName, type GroupNameInfo } from "./utils/naming"
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
/** 本次分组的命名表（非分组模式为空） */
let namingEntries: GroupNameInfo[] = []
/** 本次分桶与分片规划（未启用 split 为空） */
let splitPlan: SplitPlan | null = null
/** 是否只输出分组报表 */
const dryRun = () => process.argv.includes("--dry-run")
/** 是否输出结构化报表 */
const jsonOutput = () => process.argv.includes("--json")
/** 是否只校验产物是否与当前配置一致 */
const checkMode = () => process.argv.includes("--check")

/**
 * 判断 child 是否位于 parent 之内（含相同）。
 * @param parent 父目录
 * @param child 子目录
 * @return 是否包含
 */
function isInside(parent: string, child: string) {
  const rel = path.relative(parent, child)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

/**
 * 清理安全护栏：输出目录为仓库根、配置目录或两者的祖先时，横幅扫描会误伤整个仓库。
 * @param dir 输出目录
 * @return 拒绝原因；安全时返回 null
 */
function cleanupBlockedReason(dir: string) {
  const guards = [process.cwd(), datas.configDir ?? process.cwd()].map((item) => path.resolve(item))
  for (const guard of guards) {
    if (isInside(dir, guard)) return `输出目录 ${dir} 是 ${guard} 的祖先或本身，拒绝按横幅清理`
  }
  return null
}

/**
 * 单文件模式遗留检测：输出目录含 client + types/ 与模块文件时提示清理方式。
 * @param dir 输出目录
 * @param toJS 是否为 JS 输出
 * @return 提示文案；无遗留返回 null
 */
function groupedLeftoverHint(dir: string, toJS: boolean) {
  const ext = toJS ? ".js" : ".ts"
  if (!fs.existsSync(dir) || !fs.existsSync(path.join(dir, TYPES_DIR))) return null
  if (!fs.existsSync(path.join(dir, `${CLIENT_BASE}${ext}`))) return null
  const modules = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(ext) && !entry.name.endsWith(`.d${ext}`))
    .map((entry) => entry.name.slice(0, -ext.length))
    .filter((base) => !["index", CLIENT_BASE, "route-types"].includes(base) && !base.endsWith("Route"))
  if (modules.length === 0) return null
  return `检测到输出目录含分组模式产物（client + types/ + ${modules.length} 个模块文件），单文件模式不会自动删除旧产物；确认后执行 swagger2api prune --dir "${dir}" --yes 清理，或设置 output.clean 整目录重建`
}

/**
 * 生成失败：文本模式打印可读结论，JSON 模式输出稳定错误码与下一步。
 * 多目标模式不逐目标写 JSON，避免破坏整体汇总结构。
 * @param code 稳定错误码
 * @param message 失败原因
 * @param actions 可执行下一步
 * @return 无
 */
function onGenerateFailure(code: string, message: string, actions: string[] = []) {
  failures += 1
  // 单文档或非文档模式输出结构化结论；多文档后续仍以汇总退出码为准
  if (jsonOutput() && (!datas.docMode || (datas.docs?.length ?? 0) === 1)) {
    writeJson({ schemaVersion: DIAGNOSTIC_SCHEMA_VERSION, toolVersion: readToolVersion(), command: "generate", ok: false, errorCode: code, message, actions })
    return
  }
  console.error("失败：", message)
  actions.forEach((action) => console.error(`  - ${action}`))
}

/**
 * 临时文档路径：写到系统临时目录，避免被 output.clean 删除或进入产物目录。
 * @return 临时文件路径
 */
function createDocFile() {
  return path.join(os.tmpdir(), `swagger2api-${process.pid}-${Date.now()}.json`)
}

/** 退出 */
function onExit(message?: string, code = 0) {
  message && console.log(message)
  process.exit(code)
}
/**
 * 以错误方式退出：说明写 stderr，避免与正常输出混在一起。
 * @param message 错误说明
 * @param code 退出码
 * @return 不返回
 */
function onFailExit(message: string, code = 2): never {
  console.error(message)
  process.exit(code)
}
/** 已移除的参数：按用法错误终止并给出新参数 */
const REMOVED_FLAGS = ["--quick", "-q", "--config-all", "-ca", "--config-scan", "-cs"]

/** 加载参数 */
async function onLoadParam() {
  const removed = REMOVED_FLAGS.filter((name) => process.argv.slice(2).includes(name))
  if (removed.length > 0) {
    onFailExit(`结束：参数 ${removed.join("、")} 已移除；请改用 --target <id[,id]> 或 --all`, 2)
  }
  /** 参数 */
  datas.param = {
    config: getPValue(["--config", "-c"]),
    replaceTags: getPArray(["--replace-tags", "-rt"], { length: 2 }),
    convertGet: getPKey(["--convert-get", "-cg"]),
    removeParam: getPKey(["--remove-param", "-rp"]),
    removePrefixIndex: getPValue(["--remove-prefix-index", "-rpi"]),
    removeDts: getPKey(["--remove-dts", "-rd"]),
    timeout: getPValue("--timeout"),
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
    pruneOutput: getPKey("--prune-output"), // 按上一轮生成清单清理输出目录，不影响清单外文件（默认：false）
    ...(getPValue("--api-class-name") ? { apiClassName: getPValue("--api-class-name") } : {}), // API类名
    patch: getPKey("--patch"), // 修正Swagger源定义中的小错误（默认：false）
    debug: getPKey("--debug"), // 此工具内进程的附加信息（默认：false）
    anotherArrayType: getPKey("--another-array-type"), // 生成数组类型为 Array<Type>（默认为 Type[]）（默认：false）
    sortTypes: getPKey("--sort-types"), // 排序字段和类型（默认：false）
    extractEnums: getPKey("--extract-enums") // 从内联接口提取所有枚举类型 将内容提取到 typescript 枚举构造中（默认：false）
  } as Parameters<typeof generateApi>["0"]
  // 多目标逐目标复位用：留存命令行基线，rc 覆盖在其副本上进行
  datas.baseParam = structuredClone(datas.param)
  datas.baseConfig = structuredClone(datas.config)
  // 拉取超时：命令行显式值优先，rc 配置在 applyRcConfig 中补齐
  datas.timeout = normalizeTimeout(datas.param.timeout, "--timeout")
  // 应用 rc 配置（命令行显式参数优先）
  await onApplyDocs()
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
 * 把生效配置落到运行时：命令行显式参数始终优先。
 * @param rc 归一化后的配置
 * @return 无
 */
function applyRcConfig(rc: Record<string, any>) {
  const input = rc.input ?? {}
  const output = rc.output ?? {}
  const types = rc.types ?? {}
  const naming = rc.naming ?? {}
  const grouping = rc.grouping ?? {}
  const rcUrl = input.url ?? input.file
  if (!rcUrl) return
  // 相对路径按配置文件所在目录解析，命令行从任意目录执行都能落对位置
  const configDir = datas.configDir ?? process.cwd()
  // 配置提供输入地址即视为配置驱动：不回写配置
  datas.rcDriven = true
  datas.rcUrl = isUrl(rcUrl) ? rcUrl : path.resolve(configDir, rcUrl)
  datas.rcOutput = path.resolve(configDir, output.dir ?? "./src/api")
  datas.rcName = output.name ?? "index"
  // 类型检查策略：仅支持 skip / enforce，非法值告警后回落 skip
  if (output.typeCheck !== undefined && output.typeCheck !== "skip" && output.typeCheck !== "enforce") {
    console.error(`⚠️ 已忽略 output.typeCheck=${JSON.stringify(output.typeCheck)}：仅支持 skip / enforce，回落到 skip`)
  }
  datas.typeCheck = output.typeCheck === "enforce" ? "enforce" : "skip"
  // 横幅语言：生成配置对象不含 output 段，单独留存供统一解析
  datas.banner = output.banner
  const param = datas.param
  if (!hasFlag(["--remove-prefix-index", "-rpi"]) && naming.pathPrefixIndex !== undefined) param.removePrefixIndex = String(naming.pathPrefixIndex)
  if (!hasFlag(["--convert-get", "-cg"]) && naming.convertGetToQuery !== undefined) param.convertGet = naming.convertGetToQuery
  if (!hasFlag(["--remove-param", "-rp"]) && naming.dropPathParams !== undefined) param.removeParam = naming.dropPathParams
  if (!hasFlag(["--extract-request-query", "-erq"]) && types.extractQuery !== undefined) param.extractRequestQuery = types.extractQuery
  if (!hasFlag(["--extract-response-raw", "-err"]) && types.extractResponseRaw !== undefined) param.extractResponseRaw = Boolean(types.extractResponseRaw)
  if (!hasFlag(["--remove-dts", "-rd"]) && types.removeDts !== undefined) param.removeDts = types.removeDts
  if (!hasFlag(["--replace-tags", "-rt"]) && naming.tagRewrite) param.replaceTags = naming.tagRewrite
  const config = datas.config as Record<string, any>
  if (!hasFlag(["--axios"]) && rc.client?.type) config.httpClientType = rc.client.type === "axios" ? "axios" : "fetch"
  if (!hasFlag(["--js"]) && rc.language?.target) config.toJS = rc.language.target === "js"
  if (!hasFlag(["--responses", "-r"]) && types.responses !== undefined) config.generateResponses = Boolean(types.responses)
  if (!hasFlag(["--unwrap-response-data"]) && types.unwrapData !== undefined) config.unwrapResponseData = Boolean(types.unwrapData)
  if (!hasFlag(["--extract-request-params"]) && types.extractParams !== undefined) config.extractRequestParams = Boolean(types.extractParams)
  if (!hasFlag(["--clean-output"]) && output.clean !== undefined) config.cleanOutput = Boolean(output.clean)
  // 拉取超时：命令行显式值优先，其次 input.timeout，非法值告警后回落默认
  datas.timeout = normalizeTimeout(hasFlag(["--timeout"]) ? datas.param.timeout : input.timeout, hasFlag(["--timeout"]) ? "--timeout" : "input.timeout")
  if (!hasFlag(["--modular"]) && output.mode === "grouped") config.modular = true
  // 分组模式默认按横幅清理旧产物，业务配置不需要再写 prune
  if (!hasFlag(["--prune-output"])) config.pruneOutput = output.prune === undefined ? Boolean(config.modular) : Boolean(output.prune)
  if (!hasFlag(["--module-name-index"]) && grouping.pathDepth !== undefined) config.moduleNameIndex = Number(grouping.pathDepth)
  if (Object.keys(grouping).length) config.grouping = grouping
}

/**
 * 多文档未选择：非交互给出稳定错误码与可执行动作。
 * @param ids 可选文档 id
 * @return 不返回
 */
function onDocSelectionRequired(ids: string[]): never {
  const message = "多文档配置需要显式选择文档；非交互环境请用 --target <id[,id]> 或 --all"
  if (jsonOutput()) {
    writeJson({
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      toolVersion: readToolVersion(),
      command: "generate",
      ok: false,
      errorCode: "E_DOC_SELECTION_REQUIRED",
      message,
      actions: [`swagger2api --target ${ids[0] ?? "<id>"}`, "swagger2api --all"]
    })
    process.exit(2)
  }
  onFailExit(`结束：${message}（可选：${ids.join("、")}）`, 2)
}

/** 应用配置文档列表 */
async function onApplyDocs() {
  const flags = getConfigFlags()
  const layers = loadConfigLayers(process.cwd(), { projectFile: flags.configFile })
  layers.warnings.forEach((warning) => console.error("⚠️", warning))
  if (layers.errors.length > 0) {
    layers.errors.forEach((error) => console.error("失败：", error))
    onExit(`结束：配置有 ${layers.errors.length} 处问题`, 2)
  }
  datas.configDir = layers.project.file ? path.dirname(path.resolve(layers.project.file)) : process.cwd()
  if (!layers.merged || !hasDocs(layers.merged)) {
    if (!layers.project.file) console.error("失败：未找到 swagger2api.json；请先执行 swagger2api init，或用 --config <文件> 指定配置")
    else console.error("失败：配置缺少 docs（至少声明一个文档）")
    onExit("结束：配置不可用", 2)
  }
  const plan = resolveDocs(layers.merged as Record<string, any>, { profile: flags.profile, configDir: datas.configDir })
  plan.warnings.forEach((warning) => console.error("⚠️", warning))
  if (plan.errors.length > 0) {
    plan.errors.forEach((error) => console.error("失败：", error))
    onExit(`结束：配置有 ${plan.errors.length} 处问题，未生成任何文档`, 2)
  }
  const selection = selectDocs(plan.docs, pickDocFlags(), { interactive: canPrompt() && !jsonOutput() })
  if (selection.errors.length > 0) {
    selection.errors.forEach((error) => console.error("失败：", error))
    onExit("结束：文档选择参数不合法", 2)
  }
  if (selection.action === "required") onDocSelectionRequired(plan.docs.map((doc) => doc.id))
  let docs = selection.docs
  if (selection.action === "prompt") {
    try {
      const ids = await askCheckbox(
        "选择要生成的文档（空格切换，回车确认）",
        plan.docs.map((doc) => ({ label: doc.id, value: doc.id, description: doc.outputDir }))
      )
      // 空选视为主动放弃，正常退出
      if (ids.length === 0) onExit("未选择任何文档，已退出", 0)
      docs = plan.docs.filter((doc) => ids.includes(doc.id))
    } catch (error) {
      if (error instanceof PromptCancelled) onExit("已取消", 130)
      throw error
    }
  }
  datas.docMode = true
  datas.rcDriven = true
  datas.docs = docs
}
/**
 * 拉取远端 Swagger 文档：带显式超时，并把超时与网络错误转成可读提示。
 * @param url 文档地址
 * @return 文档对象
 */
async function fetchSpec(url: string) {
  const timeout = datas.timeout ?? DEFAULT_FETCH_TIMEOUT
  try {
    return (await axios.get(url, { timeout })).data
  } catch (error) {
    const code = String((error as { code?: string }).code ?? "")
    const message = (error as Error).message ?? ""
    if (code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout/i.test(message)) {
      throw new Error(`拉取 Swagger 文档超时（> ${timeout} 毫秒）：${url}；可重试、加 --timeout <毫秒>，或改用本地快照（input.file）`)
    }
    if (["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN", "EHOSTUNREACH"].includes(code)) {
      throw new Error(`无法连接 Swagger 源（${code}）：${url}；可重试或改用本地快照（input.file）`)
    }
    throw error
  }
}

/**
 * 读取并生成单个文档（URL 或本地文件）。
 * @param input 地址或路径
 * @return 无
 */
async function onLoadDocInput(input: string) {
  if (isUrl(input)) {
    await onGenerateApi(await fetchSpec(input))
    return
  }
  await onGenerateApi(JSON.parse(fs.readFileSync(path.resolve(input), "utf8")))
}
/**
 * 标签改写：先于分组执行，避免把分组写入的模块名再次改写。
 * @param data 文档对象（原地修改）
 */
function onReplaceTags(data: Defines["data"]) {
  const replaceTags = datas.param.replaceTags
  if (!replaceTags?.length) return
  const [pattern, replacement] = replaceTags
  // 值不足时按「降级不静默」处理：保留原始标签并说明忽略项，避免空串替换把标签清空
  if (!pattern || typeof replacement !== "string") {
    console.error("⚠️ 已忽略 --replace-tags：需要「匹配 + 替换」两个值，回落到保留原始标签")
    return
  }
  Object.values(data.paths ?? {}).forEach((item) => {
    Object.values(item).forEach((operation: any) => {
      if (Array.isArray(operation?.tags)) {
        operation.tags = operation.tags.map((tag: string) => tag.replace(new RegExp(`^${pattern}$`, "g"), replacement))
      }
    })
  })
}

/**
 * 规划产出的文件名（不含扩展名）：启用 split 时含桶、分片与门面。
 * @param entries 命名表
 * @param plan 分片规划
 * @return 去重后的文件名
 */
function plannedFileNames(entries: GroupNameInfo[], plan: SplitPlan | null) {
  const names = plan
    ? [
        ...plan.buckets.map((bucket) => bucket.fileName),
        ...plan.namespaces.flatMap((item) => item.chunks.map((chunk) => chunk.fileName)),
        ...plan.namespaces.filter((item) => item.chunks.length > 0).map((item) => item.fileName)
      ]
    : entries.map((entry) => entry.fileName)
  return [...new Set(names)]
}

/**
 * 手动模块化：按本轮生成的文件名构造聚合入口条目，避免扫描到尚未清理的旧模块。
 * @param bases 模块文件名（不含扩展名）
 * @return 聚合入口条目
 */
function entriesOf(bases: string[]) {
  return bases.map((base) => {
    const className = pascalCase(base)
    return { base, className, property: className.charAt(0).toLowerCase() + className.slice(1) }
  })
}

/**
 * 递归收集目录下的文件（相对路径，统一 / 分隔）。
 * @param dir 目录
 * @param base 基准目录
 * @return 相对路径列表
 */
function collectRelativeFiles(dir: string, base = dir): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectRelativeFiles(full, base))
    else files.push(path.relative(base, full).split(path.sep).join("/"))
  }
  return files.sort()
}

/** 产物校验结果：按缺失 / 内容不一致 / 多余三类归集 */
interface CheckResult {
  /** 本轮应生成但不存在的文件 */
  missing: string[]
  /** 存在但内容与生成结果不一致的文件 */
  mismatched: string[]
  /** 真实目录中含生成横幅、但本轮不再生成的文件 */
  extra: string[]
}

/**
 * 产物校验：临时目录的生成结果与现有产物逐文件比对，并按横幅找出多余产物。
 * @param targetDir 现有产物目录
 * @param generatedDir 临时生成目录
 * @return 校验结果
 */
function collectCheckResult(targetDir: string, generatedDir: string): CheckResult {
  const expected = collectRelativeFiles(generatedDir)
  const result: CheckResult = { missing: [], mismatched: [], extra: [] }
  for (const file of expected) {
    const target = path.join(targetDir, file)
    if (!fs.existsSync(target)) {
      result.missing.push(file)
      continue
    }
    // 行尾归一后再比对，避免 Windows 检出配置造成假差异
    const want = fs.readFileSync(path.join(generatedDir, file), "utf8").replace(/\r\n/g, "\n")
    const got = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n")
    if (want !== got) result.mismatched.push(file)
  }
  // 横幅归属：真实目录中属于生成物但本轮不再生成的文件即多余产物
  const expectedSet = new Set(expected)
  result.extra = collectGeneratedFilesOf(targetDir).filter((file) => !expectedSet.has(file))
  return result
}

/**
 * 输出校验结果：文本模式逐类列出并以稳定结论行收尾，JSON 模式输出结构化结论与下一步。
 * @param result 校验结果
 * @param targetDir 真实产物目录（动作建议用）
 * @param generatedDir 临时生成目录
 * @param split 生效的分组 split 配置，用于布局判据
 * @return 无
 */
function onCheckOutput(result: CheckResult, targetDir: string, generatedDir: string, split?: unknown) {
  const total = result.missing.length + result.mismatched.length + result.extra.length
  const actions: string[] = []
  const configFile = getConfigFlags().configFile
  const configArg = configFile ? ` --config "${path.resolve(configFile)}"` : ""
  if (result.missing.length || result.mismatched.length) actions.push(`swagger2api${configArg} # 重新生成后再校验`)
  if (result.extra.length) {
    actions.push(`swagger2api prune --dir "${targetDir}" # 预览多余产物`)
    actions.push(`swagger2api prune --dir "${targetDir}" --yes # 删除前需用户确认`)
  }
  if (jsonOutput()) {
    writeJson({
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      toolVersion: readToolVersion(),
      command: "check",
      ok: total === 0,
      errorCode: total === 0 ? null : "E_CHECK_FAILED",
      missing: result.missing,
      mismatched: result.mismatched,
      extra: result.extra,
      actions
    })
  } else if (total > 0) {
    console.error(`\n✖ 产物校验未通过：${total} 项`)
    result.missing.forEach((file) => console.error(`  - 缺少产物：${file}`))
    result.mismatched.forEach((file) => console.error(`  - 产物不一致：${file}`))
    result.extra.forEach((file) => console.error(`  - 产物多余：${file}`))
  }
  if (total > 0) {
    failures += 1
    if (!jsonOutput()) {
      // 结论行保持稳定，便于 AI 与 CI 直接匹配
      console.log(`校验结论：未通过（缺失 ${result.missing.length} / 不一致 ${result.mismatched.length} / 多余 ${result.extra.length}）`)
    }
    return
  }
  if (jsonOutput()) return
  console.log("校验：产物与当前配置一致")
  console.log("校验结论：通过")
  // 布局审计：与 inspect 同一判据，只提示不改变退出码
  const report = inspectLayout(generatedDir, inspectThresholdsOf(split))
  if (report.issues.length || report.hints.length) {
    console.log("布局审计：")
    report.issues.forEach((issue) => console.log(`  ✖ ${issue}`))
    report.hints.forEach((hint) => console.log(`  · ${hint}`))
  }
}

/**
 * 分组报表：输出命名映射、未命中规则与产物增删；dry-run 与生成前预览共用。
 * @param entries 命名表
 * @param unmatchedRules 未命中的规则下标
 * @param plan 分桶与分片规划
 */
function onGroupReport(entries: GroupNameInfo[], unmatchedRules: number[], plan: SplitPlan | null) {
  const toJS = Boolean(datas.config.toJS)
  const ext = toJS ? ".js" : ".ts"
  const dir = path.resolve(confs.param.output ?? "./src/api")
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : []
  const names = plannedFileNames(entries, plan)
  const expected = names.flatMap((name) => (toJS ? [`${name}${ext}`, `${name}.d.ts`] : [`${name}${ext}`]))
  const add = expected.filter((file) => !files.includes(file))
  const orphans = findOrphanModules(files, entries, ext, names)
  const report = {
    groups: entries.map(({ raw, fileName, className, property, importFrom, reason, source }) => ({ raw, fileName, className, property, importFrom, reason, source })),
    unmatchedRules,
    add,
    orphans,
    split: plan
      ? {
          total: plan.total,
          buckets: plan.buckets.map(({ fileName, category, routes, namespaces }) => ({ fileName, category, routes, namespaces })),
          shards: plan.namespaces
            .filter((item) => item.chunks.length > 0)
            .map(({ raw, fileName, className, routes, chunks }) => ({
              raw,
              fileName,
              className,
              routes,
              chunks: chunks.map(({ fileName: chunkFile, routes: chunkRoutes, categories }) => ({ fileName: chunkFile, routes: chunkRoutes, categories }))
            }))
        }
      : undefined
  }
  if (jsonOutput()) {
    // 多目标：逐目标报表由主流程汇总成单个 JSON，避免输出多份互不闭合的文档
    if (datas.docMode) {
      ;(datas.groupReports ??= []).push({ id: datas.currentDoc ?? "", report })
      return
    }
    writeJson(report)
    return
  }
  entries.forEach((entry) => console.log(`命名：${entry.raw} → ${entry.fileName}（类 ${entry.className}${entry.reason ? `，${entry.reason}` : ""}）`))
  plan?.buckets.forEach((bucket) =>
    console.log(`桶：${bucket.fileName}（${bucket.namespaces.length} 个命名空间 / ${bucket.routes} 条${bucket.category ? `，分类 ${bucket.category}` : ""}）`)
  )
  plan?.namespaces
    .filter((item) => item.chunks.length > 0)
    .forEach((item) => console.log(`分片：${item.raw} → ${item.chunks.map((chunk) => `${chunk.fileName}（${chunk.routes} 条）`).join("、")}`))
  if (unmatchedRules.length) console.error(`⚠️ 未命中规则：${unmatchedRules.map((index) => index + 1).join("、")}`)
  if (add.length) console.log(`预计新增：${add.join("、")}`)
  if (orphans.length) console.error(`⚠️ 表外产物（建议开启 output.prune）：${orphans.join("、")}`)
}

/**
 * 分桶模式的路由命名：生成器按桶名判重，会把不同命名空间的重名方法误加序号；
 * 桶文件内一个命名空间一个类，按命名空间判重即可复现单文件产物的方法名。
 * @return 生成器 hooks
 */
function createSplitRouteNameHook() {
  const counters = new Map<string, number>()
  return {
    onCreateRouteName(routeName: { usage: string; original: string; duplicate: boolean }, routeInfo: { tags?: string[] }) {
      // 第二标签是命名空间，桶名在第一标签，不能作为判重键
      const key = `${routeInfo?.tags?.[1] ?? ""}|${routeName.original}`
      const count = (counters.get(key) ?? 0) + 1
      counters.set(key, count)
      return { ...routeName, usage: count > 1 ? `${routeName.original}${count}` : routeName.original, duplicate: count > 1 }
    }
  }
}

/**
 * 单文件模式的路由分组：路径首段即聚合属性，命中底座成员时整体改名，
 * 避免 `request = {}` 之类直接覆盖 HttpClient 能力。
 * @param paths 文档路径集合
 * @return 生成器 hooks
 */
function createSingleNamespaceHook(paths: Record<string, any>) {
  const used = new Set<string>()
  const names = new Set<string>()
  for (const route of Object.keys(paths ?? {})) {
    const segment = route.split("/").filter(Boolean)[0]
    if (!segment) continue
    const name = toNamespaceName(segment)
    if (!name) continue
    names.add(name)
    used.add(name)
  }
  const rename = new Map<string, string>()
  names.forEach((name) => {
    if (!isReservedProperty(name)) return
    let candidate = `${name}2`
    let index = 2
    while (used.has(candidate) || isReservedProperty(candidate)) {
      index += 1
      candidate = `${name}${index}`
    }
    used.add(candidate)
    rename.set(name, candidate)
  })
  return {
    onCreateRoute(route: Record<string, any>) {
      if (!route?.namespace || !rename.has(route.namespace)) return route
      return { ...route, namespace: rename.get(route.namespace) }
    }
  }
}

/** 生成接口 */
async function onGenerateApi(data: Defines["data"]) {
  // 输入形态归一：缺字段、空文档与 Swagger 2.0 都在生成前给出可读结论
  const shape = normalizeSpecShape(data)
  shape.warnings.forEach((warning) => console.error("⚠️", warning))
  if ("error" in shape) {
    onGenerateFailure(shape.error.code, shape.error.message, shape.error.actions)
    return
  }
  data = shape.data as Defines["data"]
  // 横幅语言：缺省中文，非法值告警后回落
  const bannerLanguage = resolveBannerLanguage({ output: { banner: datas.banner } })
  // 安全守卫：解析外部引用、转义代码字面量、校验标识符字段
  const guard = await guardSpec(data, { baseUrl: isUrl(confs.param.url) ? confs.param.url : undefined })
  if (guard.errors.length > 0) {
    guard.errors.forEach((error) => console.error("失败：", error))
    failures += 1
    return
  }
  // --check：生成到临时目录后与现有产物比对，不改动真实目录
  const targetDir = path.resolve(confs.param.output)
  let checkDir: string | null = null
  if (checkMode()) {
    if (!fs.existsSync(targetDir)) {
      console.error(`失败：--check 需要已有产物目录：${targetDir}`)
      failures += 1
      return
    }
    // 临时目录贴近真实产物，保证 Prettier 解析到同一份项目配置
    checkDir = fs.mkdtempSync(path.join(path.dirname(targetDir), ".swagger2api-check-"))
    confs.param.output = checkDir
    process.once("exit", () => fs.rmSync(checkDir as string, { recursive: true, force: true }))
  }
  // 命名表按文档重置，避免批量场景沿用上一份文档的产物名
  namingEntries = []
  splitPlan = null
  datas.param.moduleClassNames = undefined
  datas.param.splitBuckets = undefined
  // 标签改写必须先于分组：分组会把模块名写进 tags，之后再改写会把模块名抹掉
  onReplaceTags(data)
  // 模块化 + 分组配置：把接口归入原始组名，再按命名表写入模块名
  const groupingConfig = (datas.config as Record<string, any>).grouping as GroupingConfig | undefined
  if (datas.config.modular && groupingConfig && (groupingConfig.strategy?.length || groupingConfig.rules?.length || groupingConfig.split)) {
    // 契约类型名参与类名避让：模块类与契约同名会在同一文件内重复声明
    const typePrefix = String((datas.config as Record<string, any>).typePrefix ?? "")
    const typeSuffix = String((datas.config as Record<string, any>).typeSuffix ?? "")
    const contractIdentifiers = Object.keys(data.components?.schemas ?? {})
      .map((key) => toClassName(slugifyGroupName(`${typePrefix}${key}${typeSuffix}`).slug))
      .filter(Boolean)
    const result = applyGrouping(data, groupingConfig, contractIdentifiers)
    result.warnings.forEach((warning) => console.error("⚠️", warning))
    if (result.errors.length > 0) {
      result.errors.forEach((error) => console.error("失败：", error))
      failures += 1
      return
    }
    namingEntries = result.entries
    splitPlan = result.split ?? null
    ;(datas.config as Record<string, any>).moduleNameFirstTag = true
    datas.param.moduleClassNames = result.moduleClassNames ?? toClassNames(result.entries)
    datas.param.splitBuckets = result.split?.bucketLayout
    // 默认在 JSDoc 中保留原始标签，避免分组名污染业务文档
    if (groupingConfig.preserveTags !== false) datas.param.groupOriginalTags = result.originalTags
    console.log("分组：", ...Object.entries(result.counts).map(([group, count]) => `${group}-${count}`))
    if (dryRun()) {
      onGroupReport(result.entries, result.unmatchedRules, splitPlan)
      return
    }
  }
  // 写盘前检查目标文件：已被手写文件占用时终止，避免静默覆盖
  if (datas.config.modular && namingEntries.length) {
    const dir = path.resolve(confs.param.output)
    // split 模式的实际文件由桶/分片/门面给出，命名空间名不再落盘，避免误判或误收手写文件
    const conflictEntries = splitPlan ? [] : namingEntries
    const conflicts = findHandwrittenConflicts(dir, conflictEntries, Boolean(datas.config.toJS), plannedFileNames(namingEntries, splitPlan))
    if (conflicts.length > 0) {
      conflicts.forEach((file) =>
        console.error(`失败：输出目录存在同名手写文件：${file}（不含生成横幅），已终止生成；确认可覆盖后删除该文件或调整分组名`)
      )
      failures += 1
      return
    }
  }
  // 处理路径
  Object.entries(data.paths).forEach((item) => {
    Object.keys(item[1]).forEach((item2) => {
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
  // 固定布局：客户端底座为 client，契约出口为 types/index；先建目录，生成器按嵌套路径直接落盘
  const outputDir = path.resolve(confs.param.output)
  // 生成前快照：后处理失败时只回滚本轮新增文件，保留原有产物
  const snapshot = checkMode() ? null : snapshotOutputFiles(outputDir)
  let completed = false
  try {
    if (datas.config.modular) {
      const modularConfig = datas.config as Record<string, any>
      modularConfig.fileNames = { ...(modularConfig.fileNames ?? {}), dataContracts: `${TYPES_DIR}/index`, httpClient: CLIENT_BASE }
      fs.mkdirSync(path.join(outputDir, TYPES_DIR), { recursive: true })
    }
    // 生成接口
    console.log("执行：", confs.file)
    // 分组模式按命名空间判重；单文件模式保证聚合属性不覆盖底座成员
    const namingHooks = datas.config.modular ? createSplitRouteNameHook() : createSingleNamespaceHook(data.paths)
    const generated = await generateApi({
      fileName: `${confs.param.name}.ts`, // 输出类型的 API 文件名称（默认："Api.ts"）
      output: outputDir, // TypeScript API 文件的输出路径（默认："./"）
      input: datas.docFile, // 路径/链接到Swagger方案
      ...datas.config,
      ...(Object.keys(namingHooks).length ? { hooks: namingHooks } : {}),
      ...{ param: datas.param }
    })
    console.log(checkMode() ? "校验：" : "完成：", path.resolve(checkMode() ? targetDir : confs.param.output, `${confs.param.name}${!datas.config.toJS ? ".ts" : ".js"}`))
    // 横幅前置：后处理失败时产物仍带当前横幅，下一轮可直接覆盖，不会被手写护栏阻断
    rewriteGeneratedBanners(outputDir, bannerLanguage).forEach((file) => console.log("处理：", path.resolve(outputDir, file)))
    // 模块化输出：分组模式按命名表校验并挂载；未分组时沿用目录扫描
    if (datas.config.modular) {
      const dir = outputDir
      const apiClassName = String((datas.config as Record<string, any>).apiClassName ?? "Api")
      const toJS = Boolean(datas.config.toJS)
      // 清理安全护栏：输出目录为仓库根、配置目录或两者的祖先时，横幅扫描会误伤整个仓库
      const blocked = checkMode() ? null : cleanupBlockedReason(dir)
      if (blocked) {
        console.error(`失败：${blocked}；本次仅生成，不删除任何文件`)
        failures += 1
      }
      if (namingEntries.length) {
        const extraFiles = plannedFileNames(namingEntries, splitPlan)
        // 分片门面由本工具补写，必须先于产物校验与聚合入口
        if (splitPlan) writeSplitFacades(dir, splitPlan.namespaces, toJS, bannerLanguage, (datas.config as Record<string, any>).httpClientType === "axios")
        // 契约按业务文件拆分：barrel 仍是 types/index，业务文件的导入路径不变
        const contracts = splitContractOutput({ dir, moduleFiles: extraFiles, toJS, language: bannerLanguage })
        if (contracts.errors.length > 0) {
          contracts.errors.forEach((error) => console.error("失败：", error))
          failures += 1
          return
        }
        const modules = verifyGroupedOutput(dir, namingEntries, toJS, { aggregate: false, extraFiles })
        if (modules.errors.length > 0) {
          modules.errors.forEach((error) => console.error("失败：", error))
          failures += 1
          return
        }
        writeAggregateEntry(dir, apiClassName, toJS, toModuleEntries(namingEntries), bannerLanguage, buildCollisionExports(dir, apiClassName))
        const { errors, orphans } = verifyGroupedOutput(dir, namingEntries, toJS, { extraFiles })
        if (errors.length > 0) {
          errors.forEach((error) => console.error("失败：", error))
          failures += 1
          return
        }
        orphans.forEach((file) => console.error("⚠️ 表外产物（建议开启 output.prune）：", file))
        // 横幅清理：删除本轮不再生成的旧产物；开关关闭时只报告不删除
        const keep = collectGeneratedFiles(dir, splitPlan ? [] : namingEntries, toJS, extraFiles)
        const stale = findStaleOutputFiles(dir, keep)
        if (stale.length > 0 && datas.config.pruneOutput && !checkMode() && !blocked) {
          pruneGeneratedOutput(dir, keep).forEach((file) => console.log("清理：", path.resolve(dir, file)))
        } else if (stale.length > 0 && !checkMode()) {
          console.error(`⚠️ 产物多余（未开启 output.prune，未删除）：${stale.join("、")}`)
        }
      } else {
        // 手动模块化没有命名表：按本轮实际生成的文件确定模块集合
        const generatedFiles = ((generated as { files?: Array<{ fileName?: string; fileExtension?: string }> }).files ?? [])
          .map((file) => `${String(file.fileName ?? "").replace(/\\/g, "/")}${file.fileExtension ?? ""}`)
          .filter((name) => Boolean(name) && !name.startsWith("."))
        const modules = generatedFiles
          .filter((name) => !name.includes("/") && !name.endsWith(".d.ts"))
          .map((name) => name.slice(0, name.lastIndexOf(".")))
          .filter((base) => Boolean(base) && !["index", CLIENT_BASE, "route-types"].includes(base) && !base.endsWith("Route"))
        const contracts = splitContractOutput({ dir, moduleFiles: modules, toJS, language: bannerLanguage })
        if (contracts.errors.length > 0) {
          contracts.errors.forEach((error) => console.error("失败：", error))
          failures += 1
          return
        }
        writeAggregateEntry(dir, apiClassName, toJS, entriesOf(modules), bannerLanguage)
        if (!checkMode() && !blocked) {
          // keep 在补写聚合入口与契约之后计算，避免把本轮刚写的产物误判为多余
          const keep = collectGeneratedFiles(dir, [], toJS, modules)
          pruneGeneratedOutput(dir, keep).forEach((file) => console.log("清理：", path.resolve(dir, file)))
        }
      }
      // 升级退场：全部产物校验通过后再删除旧版固定产物，失败时保持原样
      if (!checkMode()) removeLegacyOutput(dir, toJS).forEach((file) => console.log("清理：", path.resolve(dir, file)))
    }
    // 单文件模式：不自动删除旧分组产物，检测到遗留时提示清理方式，避免模式切换时静默大删
    if (!datas.config.modular && !checkMode()) {
      const hint = groupedLeftoverHint(targetDir, Boolean(datas.config.toJS))
      if (hint) console.error(`⚠️ ${hint}`)
    }
    // 类型检查策略：写盘完成后剥离 @ts-nocheck；--check 的临时产物走同一处理再比对
    if (datas.typeCheck === "enforce") {
      stripTsNoCheck(outputDir).forEach((file) => console.log("处理：", path.resolve(outputDir, file)))
    }
    if (datas.config.toJS) {
      console.log(checkMode() ? "校验：" : "完成：", path.resolve(checkMode() ? targetDir : confs.param.output, `${confs.param.name}.d.ts`))
    }
    // 产物校验：临时目录与现有产物逐文件比对
    if (checkDir) onCheckOutput(collectCheckResult(targetDir, checkDir), targetDir, checkDir, datas.config.grouping?.split)
    // 移除使用--js参数时生成的d.ts文件（校验模式不动真实目录）
    if (datas.param.removeDts && !checkMode()) {
      console.log("清理：", path.resolve(confs.param.output, `${confs.param.name}.d.ts`))
      execSync(`npx rimraf ${path.resolve(confs.param.output, `${confs.param.name}.d.ts`)}`, { cwd: datas.home }).toString()
    }
    completed = true
  } finally {
    // 失败回滚：只删除本轮新增的文件与空目录，原有产物保留
    if (!completed && snapshot) removeNewOutputFiles(outputDir, snapshot).forEach((file) => console.log("回滚：", file))
    // 临时文档在任何返回路径都清理
    if (fs.existsSync(datas.docFile)) fs.unlinkSync(datas.docFile)
  }
}
/**
 * 多文档：逐文档复位运行时后生成；单个失败不阻断其余文档，最终聚合退出码。
 * @return 无
 */
async function onRunDocs() {
  const docs = datas.docs ?? []
  const summary: Array<{ id: string; ok: boolean; report?: Record<string, any> }> = []
  let failed = 0
  for (const doc of docs) {
    // 每个文档独立复位：参数、配置、统计与命名表互不串味
    datas.param = structuredClone(datas.baseParam) as Defines["datas"]["param"]
    datas.config = structuredClone(datas.baseConfig) as Defines["datas"]["config"]
    datas.enum = {}
    namingEntries = []
    splitPlan = null
    datas.groupReports = []
    datas.currentDoc = doc.id
    applyRcConfig(doc.config)
    confs.file = `(docs:${doc.id})`
    confs.param = { url: datas.rcUrl, output: datas.rcOutput, name: datas.rcName }
    datas.docFile = createDocFile()
    console.log(`\n文档：${doc.id}（${doc.input} → ${doc.outputDir}）`)
    const before = failures
    try {
      await onLoadDocInput(doc.input)
    } catch (error) {
      failures += 1
      console.error(`失败：文档 ${doc.id}：${(error as Error).message}`)
    }
    const ok = failures === before
    if (!ok) failed += 1
    summary.push({ id: doc.id, ok, report: datas.groupReports?.[0]?.report })
  }
  // dry-run 的结构化报表按文档汇总成单个 JSON
  if (dryRun() && jsonOutput()) writeJson({ docs: summary })
  if (failed > 0) onExit(`结束：${failed} 个文档失败（共 ${docs.length} 个），其余文档已完成`, 1)
}

/** 主线 */
async function onMain() {
  // 参数阶段即完成配置加载与文档预校验，未通过时已退出
  await onLoadParam()
  await onRunDocs()
}
// 导出方法
export { onMain as generateApi }
