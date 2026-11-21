import axios from "axios"
import { execSync } from "node:child_process"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import prompts from "prompts"
import { generateApi } from "swagger-typescript-api"
import { Defines, DIAGNOSTIC_SCHEMA_VERSION, getDirname, getPArray, getPKey, getPValue, isUrl, readToolVersion, saveFile, scanConfigFiles, writeJson } from "./utils"
import { guardSpec } from "./utils/security/spec-guard"
import { applyEnvOverrides, applyProfile, findOutputDirConflicts, getConfigFlags, loadConfigLayers, normalizeConfig } from "./utils/config"
import { hasTargets, pickTargetFlag, resolveTargets } from "./utils/targets"
import { stripTsNoCheck } from "./utils/postprocess"
import {
  collectGeneratedFiles,
  collectGeneratedFilesOf,
  findHandwrittenConflicts,
  findStaleOutputFiles,
  pruneGeneratedOutput,
  removeLegacyOutput,
  toModuleEntries,
  verifyGroupedOutput,
  writeAggregateEntry,
  writeSplitFacades
} from "./utils/modular"
import { inspectLayout, inspectThresholdsOf } from "./utils/inspect"
import { applyGrouping, type GroupingConfig, type SplitPlan } from "./utils/grouping"
import { splitContractOutput } from "./utils/contracts"
import { CLIENT_BASE, TYPES_DIR, findOrphanModules, toClassNames, type GroupNameInfo } from "./utils/naming"
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
 * 输出跨配置输出目录冲突：JSON 模式给出稳定错误码与可直接执行的下一步。
 * @param conflicts 冲突说明
 * @return 无
 */
function onConfigConflict(conflicts: string[]) {
  if (!jsonOutput()) {
    conflicts.forEach((conflict) => console.error("失败：", conflict))
    return
  }
  writeJson({
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    toolVersion: readToolVersion(),
    command: "generate",
    ok: false,
    errorCode: "E_CONFIG_CONFLICT",
    message: conflicts.join("；"),
    actions: ["swagger2api config status # 查看生效配置与环境变量覆盖", "swagger2api --dry-run --json # 预览本次目标与产物"]
  })
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
  // rc 提供输入地址即视为配置驱动：不扫描、不回写 saconfig
  datas.rcDriven = true
  datas.rcUrl = isUrl(rcUrl) ? rcUrl : path.resolve(configDir, rcUrl)
  datas.rcOutput = path.resolve(configDir, output.dir ?? "./src/api")
  datas.rcName = output.name ?? "index"
  // 类型检查策略：仅支持 skip / enforce，非法值告警后回落 skip
  if (output.typeCheck !== undefined && output.typeCheck !== "skip" && output.typeCheck !== "enforce") {
    console.error(`⚠️ 已忽略 output.typeCheck=${JSON.stringify(output.typeCheck)}：仅支持 skip / enforce，回落到 skip`)
  }
  datas.typeCheck = output.typeCheck === "enforce" ? "enforce" : "skip"
  const param = datas.param
  param.quick = true
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
  if (!hasFlag(["--modular"]) && output.mode === "grouped") config.modular = true
  // 分组模式默认按清单清理旧产物，业务配置不需要再写 prune
  if (!hasFlag(["--prune-output"])) config.pruneOutput = output.prune === undefined ? Boolean(config.modular) : Boolean(output.prune)
  if (!hasFlag(["--module-name-index"]) && grouping.pathDepth !== undefined) config.moduleNameIndex = Number(grouping.pathDepth)
  if (Object.keys(grouping).length) config.grouping = grouping
}

/**
 * 应用 rc 配置：多目标先整体预校验再挑选目标，单目标沿用原流程。
 * @return 无
 */
function onApplyRc() {
  const flags = getConfigFlags()
  const layers = loadConfigLayers(process.cwd(), { projectFile: flags.configFile })
  layers.warnings.forEach((warning) => console.error("⚠️", warning))
  datas.configDir = layers.project.file ? path.dirname(path.resolve(layers.project.file)) : process.cwd()
  // 多目标：配置错误一次报完并以退出码 2 终止，不写任何目标，避免半批产物
  if (hasTargets(layers.merged)) {
    if (String(flags.configFile ?? "").includes(",")) {
      console.error("失败：多目标配置只接受单个 --config 文件")
      onExit("结束：--config 不接受多个文件", 2)
    }
    const picked = pickTargetFlag()
    if (picked.errors.length > 0) {
      picked.errors.forEach((error) => console.error("失败：", error))
      onExit("结束：目标参数不合法", 2)
    }
    const plan = resolveTargets(layers.merged as Record<string, any>, { profile: flags.profile, configDir: datas.configDir })
    plan.warnings.forEach((warning) => console.error("⚠️", warning))
    if (plan.errors.length > 0) {
      plan.errors.forEach((error) => console.error("失败：", error))
      onExit(`结束：多目标配置有 ${plan.errors.length} 处问题，未生成任何目标`, 2)
    }
    if (picked.id && !plan.targets.some((target) => target.id === picked.id)) {
      console.error(`失败：未知目标 ${picked.id}（可选：${plan.targets.map((target) => target.id).join("、")}）`)
      onExit("结束：--target 未匹配任何目标", 2)
    }
    datas.targetMode = true
    datas.rcDriven = true
    datas.targets = picked.id ? plan.targets.filter((target) => target.id === picked.id) : plan.targets
    // 同目录其他配置若与本配置输出重叠，两边的横幅清理会互删产物
    const conflicts = findOutputDirConflicts({
      configDir: datas.configDir as string,
      currentFile: layers.project.file,
      outputDirs: (datas.targets ?? []).map((target) => path.resolve(target.outputDir))
    })
    if (conflicts.length > 0) {
      onConfigConflict(conflicts)
      onExit("结束：配置输出目录冲突，未生成任何目标", 2)
    }
    return
  }
  // 单目标：--target 只在多目标配置下有意义，脚本残留时明确报错而非静默失效
  const picked = pickTargetFlag()
  if (picked.errors.length > 0) {
    picked.errors.forEach((error) => console.error("失败：", error))
    onExit("结束：目标参数不合法", 2)
  }
  if (picked.id) {
    console.error("失败：当前配置没有 targets，--target 无法使用")
    onExit("结束：--target 需要多目标配置", 2)
  }
  // 先归一化扁平配置，再套预设、再做一次归一化，兼容预设内继续使用扁平字段
  const rc = applyEnvOverrides(normalizeConfig(applyProfile(normalizeConfig(layers.merged), flags.profile)))
  applyRcConfig(rc)
  if (!datas.rcUrl || !datas.rcOutput) return
  // 同目录其他配置若与本配置输出重叠，两边的横幅清理会互删产物
  const conflicts = findOutputDirConflicts({ configDir: datas.configDir as string, currentFile: layers.project.file, outputDirs: [datas.rcOutput] })
  if (conflicts.length > 0) {
    onConfigConflict(conflicts)
    onExit("结束：配置输出目录冲突，未生成任何产物", 2)
  }
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
    datas.docFile = createDocFile()
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
  datas.docFile = createDocFile()
}
/**
 * 读取并生成单个文档（URL 或本地文件）。
 * @param input 地址或路径
 * @return 无
 */
async function onLoadDocInput(input: string) {
  if (isUrl(input)) {
    const response = await axios.get(input)
    await onGenerateApi(response.data)
    return
  }
  await onGenerateApi(JSON.parse(fs.readFileSync(path.resolve(input), "utf8")))
}
/** 加载文档 */
async function onLoadDoc(index = 0) {
  // 疏理文件
  confs.file = confs.files[index]
  // 输入配置
  await onInputParam()
  // 检查地址：读取失败计入失败数，批量场景下继续处理其余文档
  try {
    await onLoadDocInput(confs.param.url as string)
  } catch (error) {
    failures += 1
    console.error("失败：", error)
  }
  // 加载下一个文档
  if (confs.files[index + 1]) {
    await onLoadDoc(index + 1)
  } else if (failures > 0) {
    // 批量场景下跳过失败文档，但整体以非 0 退出，避免静默降级
    onExit(`结束：${failures} 个文档未生成，失败原因见上方输出`, 1)
  }
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
    if (datas.targetMode) {
      ;(datas.groupReports ??= []).push({ id: datas.currentTarget ?? "", report })
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
 * 这里改为按命名空间判重，复现单文件产物的方法名。
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
    const result = applyGrouping(data, groupingConfig)
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
  if (datas.config.modular) {
    const modularConfig = datas.config as Record<string, any>
    modularConfig.fileNames = { ...(modularConfig.fileNames ?? {}), dataContracts: `${TYPES_DIR}/index`, httpClient: CLIENT_BASE }
    fs.mkdirSync(path.join(path.resolve(confs.param.output), TYPES_DIR), { recursive: true })
  }
  // 生成接口
  console.log("执行：", confs.file)
  const generated = await generateApi({
    fileName: `${confs.param.name}.ts`, // 输出类型的 API 文件名称（默认："Api.ts"）
    output: path.resolve(confs.param.output), // TypeScript API 文件的输出路径（默认："./"）
    input: datas.docFile, // 路径/链接到Swagger方案
    ...datas.config,
    // 分桶后模块名统一为桶名，需按命名空间恢复方法名判重
    ...(splitPlan ? { hooks: createSplitRouteNameHook() } : {}),
    ...{ param: datas.param }
  })
  console.log(checkMode() ? "校验：" : "完成：", path.resolve(checkMode() ? targetDir : confs.param.output, `${confs.param.name}${!datas.config.toJS ? ".ts" : ".js"}`))
  // 模块化输出：分组模式按命名表校验并挂载；未分组时沿用目录扫描
  if (datas.config.modular) {
    const dir = path.resolve(confs.param.output)
    const apiClassName = String((datas.config as Record<string, any>).apiClassName ?? "Api")
    const toJS = Boolean(datas.config.toJS)
    // 清理安全护栏：输出目录为仓库根、配置目录或两者的祖先时，横幅扫描会误伤整个仓库
    const blocked = checkMode() ? null : cleanupBlockedReason(dir)
    if (blocked) {
      console.error(`失败：${blocked}；本次仅生成，不删除任何文件`)
      failures += 1
    }
    // 升级退场：旧版固定产物已不再生成，成功落盘后删除残留（校验模式不动真实目录）
    if (!checkMode()) removeLegacyOutput(dir, toJS).forEach((file) => console.log("清理：", path.resolve(dir, file)))
    if (namingEntries.length) {
      const extraFiles = plannedFileNames(namingEntries, splitPlan)
      // 分片门面由本工具补写，必须先于产物校验与聚合入口
      if (splitPlan) writeSplitFacades(dir, splitPlan.namespaces, toJS)
      // 契约按业务文件拆分：barrel 仍是 types/index，业务文件的导入路径不变
      const contracts = splitContractOutput({ dir, moduleFiles: extraFiles, toJS })
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
      writeAggregateEntry(dir, apiClassName, toJS, toModuleEntries(namingEntries))
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
      // 手动模块化没有命名表：按本轮实际生成的文件确定模块集合，先按横幅清掉旧产物再补写聚合入口
      const generatedFiles = ((generated as { files?: Array<{ fileName?: string; fileExtension?: string }> }).files ?? [])
        .map((file) => `${String(file.fileName ?? "").replace(/\\/g, "/")}${file.fileExtension ?? ""}`)
        .filter((name) => Boolean(name) && !name.startsWith("."))
      const modules = generatedFiles
        .filter((name) => !name.includes("/") && !name.endsWith(".d.ts"))
        .map((name) => name.slice(0, name.lastIndexOf(".")))
        .filter((base) => Boolean(base) && !["index", CLIENT_BASE, "route-types"].includes(base) && !base.endsWith("Route"))
      const keep = collectGeneratedFiles(dir, [], toJS, modules)
      if (!checkMode() && !blocked) {
        // keep 内的文件本轮会重建，留旧产物会让聚合入口继续引用幽灵模块
        pruneGeneratedOutput(dir, keep).forEach((file) => console.log("清理：", path.resolve(dir, file)))
      }
      const contracts = splitContractOutput({ dir, moduleFiles: modules, toJS })
      if (contracts.errors.length > 0) {
        contracts.errors.forEach((error) => console.error("失败：", error))
        failures += 1
        return
      }
      writeAggregateEntry(dir, apiClassName, toJS)
    }
  }
  // 单文件模式：不自动删除旧分组产物，检测到遗留时提示清理方式，避免模式切换时静默大删
  if (!datas.config.modular && !checkMode()) {
    const hint = groupedLeftoverHint(targetDir, Boolean(datas.config.toJS))
    if (hint) console.error(`⚠️ ${hint}`)
  }
  // 类型检查策略：写盘完成后剥离 @ts-nocheck；--check 的临时产物走同一处理再比对
  if (datas.typeCheck === "enforce") {
    const dir = path.resolve(confs.param.output)
    stripTsNoCheck(dir).forEach((file) => console.log("处理：", path.resolve(dir, file)))
  }
  if (datas.config.toJS) {
    console.log(checkMode() ? "校验：" : "完成：", path.resolve(checkMode() ? targetDir : confs.param.output, `${confs.param.name}.d.ts`))
  }
  // 产物校验：临时目录与现有产物逐文件比对
  if (checkDir) onCheckOutput(collectCheckResult(targetDir, checkDir), targetDir, checkDir, datas.config.grouping?.split)
  // 删除临时文档
  if (fs.existsSync(datas.docFile)) fs.unlinkSync(datas.docFile)
  // 移除使用--js参数时生成的d.ts文件（校验模式不动真实目录）
  if (datas.param.removeDts && !checkMode()) {
    console.log("清理：", path.resolve(confs.param.output, `${confs.param.name}.d.ts`))
    execSync(`npx rimraf ${path.resolve(confs.param.output, `${confs.param.name}.d.ts`)}`, { cwd: datas.home }).toString()
  }
  // 保存配置（rc 驱动时不回写 saconfig）
  if (!datas.rcDriven) saveFile(confs.file, JSON.stringify(confs.param, null, 2))
}
/**
 * 多目标：逐目标复位运行时后生成；单个失败不阻断其余目标，最终聚合退出码。
 * @return 无
 */
async function onRunTargets() {
  const targets = datas.targets ?? []
  const summary: Array<{ id: string; ok: boolean; report?: Record<string, any> }> = []
  let failed = 0
  for (const target of targets) {
    // 每个目标独立复位：参数、配置、统计与命名表互不串味
    datas.param = structuredClone(datas.baseParam) as Defines["datas"]["param"]
    datas.config = structuredClone(datas.baseConfig) as Defines["datas"]["config"]
    datas.enum = {}
    namingEntries = []
    splitPlan = null
    datas.groupReports = []
    datas.currentTarget = target.id
    applyRcConfig(target.config)
    confs.file = `(targets:${target.id})`
    confs.param = { url: datas.rcUrl, output: datas.rcOutput, name: datas.rcName }
    datas.docFile = createDocFile()
    console.log(`\n目标：${target.id}（${target.input} → ${target.outputDir}）`)
    const before = failures
    try {
      await onLoadDocInput(target.input)
    } catch (error) {
      failures += 1
      console.error(`失败：目标 ${target.id}：${(error as Error).message}`)
    }
    const ok = failures === before
    if (!ok) failed += 1
    summary.push({ id: target.id, ok, report: datas.groupReports?.[0]?.report })
  }
  // dry-run 的结构化报表按目标汇总成单个 JSON
  if (dryRun() && jsonOutput()) writeJson({ targets: summary })
  if (failed > 0) onExit(`结束：${failed} 个目标失败（共 ${targets.length} 个），其余目标已完成`, 1)
}

/** 主线 */
async function onMain() {
  // 加载参数
  await onLoadParam()
  // 多目标：配置已在参数阶段整体预校验，直接逐目标执行
  if (datas.targetMode) {
    await onRunTargets()
    return
  }
  // 加载配置
  await onLoadConfig()
  // 加载文档
  await onLoadDoc()
}
// 导出方法
export { onMain as generateApi }
