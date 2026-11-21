import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import prompts from "prompts"
import axios from "axios"
import {
  CONFIG_ENV_OVERRIDES,
  CONFIG_LOCAL_FILE,
  CONFIG_PROJECT_FILE,
  applyEnvOverrides,
  applyProfile,
  describeLayers,
  getConfigFlags,
  loadConfigLayers,
  mergeShallow,
  normalizeConfig
} from "./utils/config"
import { hasTargets, pickTargetFlag, resolveTargets } from "./utils/targets"
import { SURFACE_FORMAT_VERSION, collectSurface, compareSurface, type SurfacePayload } from "./utils/surface"
import { formatInspectReport, inspectLayout, resolveInspectThresholds } from "./utils/inspect"
import { migrateFromPackage } from "./utils/migrate"
import { applyGrouping, type GroupingConfig, type GroupingRule } from "./utils/grouping"
import { DIAGNOSTIC_SCHEMA_VERSION, canPrompt, normalizeTimeout, readToolVersion, writeJson } from "./utils"
import { collectGeneratedFilesOf } from "./utils/modular"

/**
 * 输出诊断命令的失败结果：JSON 模式给出稳定错误码与可执行下一步，否则打印人类可读错误。
 * @param argv 参数列表
 * @param command 命令标识
 * @param errorCode 稳定错误码
 * @param message 错误说明
 * @param actions 建议的下一步命令
 * @return 退出码 2
 */
function diagnosticError(argv: string[], command: string, errorCode: string, message: string, actions: string[] = []) {
  if (argv.includes("--json")) {
    writeJson({ schemaVersion: DIAGNOSTIC_SCHEMA_VERSION, toolVersion: readToolVersion(), command, ok: false, errorCode, message, actions })
  } else {
    console.error(`失败：${message}`)
  }
  return 2
}

/** .gitignore 片段标识：认领本工具写入的注释行，重跑时据此改写 */
const GITIGNORE_MARKER = "# @fxri/swagger2api"
/** .gitignore 片段内容 */
const GITIGNORE_ROWS = [CONFIG_LOCAL_FILE, "*.swagger2apirc.local.json"]

/**
 * 写入受管的 .gitignore 片段（幂等）：已有片段时补齐新增忽略项。
 * @param dir 目录
 * @return 无
 */
function ensureGitignore(dir: string) {
  const file = path.join(dir, ".gitignore")
  const rows = [`${GITIGNORE_MARKER} 个人配置不入库`, ...GITIGNORE_ROWS]
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  if (!existing.includes(GITIGNORE_MARKER)) {
    const content = existing && !existing.endsWith("\n") ? `${existing}\n` : existing
    fs.writeFileSync(file, `${content}${rows.join("\n")}\n`)
    return
  }
  const missing = GITIGNORE_ROWS.filter((row) => !existing.includes(row))
  if (missing.length === 0) return
  const eol = existing.includes("\r\n") ? "\r\n" : "\n"
  const lines = existing.split(/\r?\n/)
  const index = lines.findIndex((line) => line.includes(GITIGNORE_MARKER))
  lines.splice(index + 1, 0, ...missing)
  fs.writeFileSync(file, lines.join(eol))
}

/**
 * 合并写入配置文件。
 * @param file 配置路径
 * @param patch 待写入的配置段
 * @return 无
 */
function writeConfig(file: string, patch: Record<string, any>) {
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
  const merged = mergeShallow(existing, patch)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`)
}

/**
 * 交互式收集配置。
 * @return 配置段
 */
async function askConfig() {
  const answers = await prompts([
    { name: "url", type: "text", message: "Swagger 地址或本地文件:", initial: "" },
    { name: "dir", type: "text", message: "输出目录:", initial: "./src/api" },
    { name: "name", type: "text", message: "入口文件名:", initial: "index" },
    {
      name: "client",
      type: "select",
      message: "HTTP 客户端:",
      choices: [
        { title: "axios", value: "axios" },
        { title: "fetch", value: "fetch" }
      ],
      initial: 0
    },
    {
      name: "language",
      type: "select",
      message: "输出语言:",
      choices: [
        { title: "TypeScript", value: "ts" },
        { title: "JavaScript", value: "js" }
      ],
      initial: 0
    },
    { name: "responses", type: "toggle", message: "生成响应类型信息?", initial: true, active: "是", inactive: "否" },
    { name: "grouped", type: "toggle", message: "按组拆分为多文件?", initial: false, active: "是", inactive: "否" }
  ])
  const patch: Record<string, any> = {
    input: { url: answers.url },
    output: { dir: answers.dir, name: answers.name, mode: answers.grouped ? "grouped" : "single" },
    client: { type: answers.client },
    language: { target: answers.language },
    types: { responses: Boolean(answers.responses) }
  }
  return patch
}

/**
 * 执行 init：交互向导或从既有脚本迁移。
 * @return 退出码
 */
export async function runInit() {
  const argv = process.argv.slice(2)
  const targetIndex = argv.findIndex((item) => item === "--config" || item === "-c")
  const targetFile = targetIndex === -1 ? path.join(process.cwd(), CONFIG_PROJECT_FILE) : path.resolve(argv[targetIndex + 1])
  const scriptIndex = argv.findIndex((item) => item === "--from-script")
  const scriptPackage = scriptIndex === -1 ? undefined : path.resolve(argv[scriptIndex + 1] ?? "package.json")

  if (scriptPackage) {
    const result = migrateFromPackage(scriptPackage)
    writeConfig(targetFile, result.config)
    ensureGitignore(process.cwd())
    console.log(`已从脚本 ${result.scriptName} 迁移配置到 ${targetFile}`)
    if (result.unknown.length) {
      console.error(`⚠️ 以下参数未能识别，请手动补充：${result.unknown.join("、")}`)
    }
    return result.unknown.length ? 1 : 0
  }

  if (!canPrompt()) {
    console.error("init 需要交互式终端；非交互环境请用 swagger2api init --from-script package.json 迁移，或手写 swagger2api.json")
    return 2
  }
  const patch = await askConfig()
  writeConfig(targetFile, patch)
  ensureGitignore(process.cwd())
  console.log(`已写入配置：${targetFile}`)
  return 0
}

/**
 * 执行 config status：展示各层来源、环境变量覆盖与合并结果。
 * @return 退出码
 */
export function runConfigStatus() {
  const { configFile, profile } = getConfigFlags()
  const layers = loadConfigLayers(process.cwd(), { projectFile: configFile })
  const effective = applyEnvOverrides(applyProfile(layers.merged, profile))
  const payload = {
    layers: describeLayers(layers),
    envOverrides: CONFIG_ENV_OVERRIDES.filter((item) => process.env[item.env] !== undefined).map((item) => `${item.env} → ${item.key}`),
    profile: profile ?? null,
    effective,
    warnings: layers.warnings
  }
  if (process.argv.includes("--json")) {
    writeJson(payload)
  } else {
    payload.layers.forEach((line) => console.log(line))
    payload.envOverrides.length ? console.log(`环境变量：${payload.envOverrides.join("；")}`) : console.log("环境变量：无")
    console.log(`预设：${payload.profile ?? "未指定"}`)
    payload.warnings.forEach((warning) => console.error(`⚠️ ${warning}`))
  }
  return 0
}

/**
 * 加载 swagger 文档（本地文件或 http(s) 地址），远端拉取带超时与可读错误。
 * @param input 地址或路径
 * @param timeout 超时毫秒数
 * @return 文档对象
 */
async function loadSpec(input: string, timeout: number) {
  if (/^https?:\/\//i.test(input)) {
    try {
      return (await axios.get(input, { timeout })).data
    } catch (error) {
      const code = String((error as { code?: string }).code ?? "")
      if (code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout/i.test((error as Error).message ?? "")) {
        throw new Error(`拉取文档超时（> ${timeout} 毫秒）：${input}；可重试、加 --timeout <毫秒>，或改用本地快照`)
      }
      throw error
    }
  }
  return JSON.parse(fs.readFileSync(path.resolve(input), "utf8"))
}

/**
 * 统计标签与路径首段的分布，供分组向导展示。
 * @param spec 文档对象
 * @return 统计结果
 */
function collectStats(spec: Record<string, any>) {
  const tags: Record<string, number> = {}
  const prefixes: Record<string, number> = {}
  let total = 0
  for (const [routePath, item] of Object.entries(spec.paths ?? {})) {
    const first = routePath.split("/").filter(Boolean)[0] ?? "(root)"
    prefixes[first] = (prefixes[first] ?? 0) + 1
    for (const method of ["get", "post", "put", "delete", "patch", "head", "options"]) {
      const operation = (item as Record<string, any>)[method]
      if (!operation || typeof operation !== "object") continue
      total += 1
      const tag = (operation.tags ?? [])[0] ?? "(无标签)"
      tags[tag] = (tags[tag] ?? 0) + 1
    }
  }
  return { tags, prefixes, total }
}

/**
 * 执行 grouping：展示分布并（交互式）写入分组配置。
 * @return 退出码
 */
export async function runGrouping() {
  const { configFile, profile } = getConfigFlags()
  const layers = loadConfigLayers(process.cwd(), { projectFile: configFile })
  const rc = applyEnvOverrides(applyProfile(layers.merged, profile))
  const input = rc.input?.url ?? rc.input?.file
  if (!input) {
    console.error("未找到 input 配置，请先执行 swagger2api init")
    return 1
  }
  let spec: Record<string, any>
  try {
    const timeout = normalizeTimeout(rc.input?.timeout ?? (rc as Record<string, any>).timeout, "input.timeout")
    spec = await loadSpec(input, timeout)
  } catch (error) {
    console.error(`读取文档失败：${(error as Error).message}`)
    return 1
  }
  const stats = collectStats(spec)
  console.log(`共 ${stats.total} 个接口`)
  console.log("按标签分布：", ...Object.entries(stats.tags).map(([tag, count]) => `${tag}-${count}`))
  console.log("按路径首段分布：", ...Object.entries(stats.prefixes).map(([prefix, count]) => `${prefix}-${count}`))

  if (!canPrompt()) {
    // 报表已输出，但写入配置必须交互：明确原因与等价做法，不静默成功
    console.error("grouping 需要交互式终端写入配置；非交互环境请直接把 grouping 段写进 swagger2api.json")
    return 2
  }
  const answers = await prompts([
    {
      name: "strategy",
      type: "select",
      message: "分组依据：",
      choices: [
        { title: "按标签（tag）", value: "tag" },
        { title: "按路径段", value: "path" },
        { title: "按显式规则（稍后在配置里补）", value: "rules" }
      ],
      initial: 0
    },
    { name: "pathDepth", type: "number", message: "路径段深度（按路径分组时生效）:", initial: 0 },
    { name: "fallback", type: "text", message: "兜底组名:", initial: "misc" }
  ])
  const rules: GroupingRule[] = []
  if (answers.strategy === "rules") {
    // 规则编辑：循环录入「匹配方式 + 匹配值 + 组名」，可直接回车结束
    let more = true
    while (more) {
      const rule = await prompts([
        {
          name: "kind",
          type: "select",
          message: "规则匹配方式：",
          choices: [
            { title: "路径前缀", value: "prefix" },
            { title: "标签", value: "tag" }
          ],
          initial: 0
        },
        { name: "value", type: "text", message: "匹配值（留空结束）：" },
        { name: "group", type: "text", message: "归入组名：" }
      ])
      if (!rule.value || !rule.group) break
      rules.push({ match: { [rule.kind]: rule.value } as GroupingRule["match"], group: rule.group })
      const next = await prompts({ name: "again", type: "confirm", message: "继续添加规则？", initial: false })
      more = Boolean(next.again)
    }
  }
  const grouping: GroupingConfig = {
    strategy: [answers.strategy],
    pathDepth: Number(answers.pathDepth ?? 0),
    rules,
    fallback: answers.fallback || "misc",
    preserveTags: true,
    // 阈值由工具默认，预览直接按最终的分桶/分片结果展示
    split: true
  }
  // 命名预览：在副本上跑一次分组，避免改动原始文档
  const existingNames = (rc.grouping?.names ?? {}) as Record<string, string>
  const preview = applyGrouping(JSON.parse(JSON.stringify(spec)), { ...grouping, names: existingNames })
  preview.warnings.forEach((warning) => console.error(`⚠️ ${warning}`))
  console.log("命名预览：")
  preview.entries.forEach((entry) => {
    const notes = [entry.source === "fallback" ? "兜底" : entry.source === "manual" ? "手工" : "", entry.reason].filter(Boolean).join("；")
    console.log(`  ${entry.raw} → ${entry.fileName}${notes ? `（${notes}）` : ""}`)
  })
  // 只对需要人工判断的组询问模块名：兜底名、保留名冲突、重名
  const names: Record<string, string> = { ...existingNames }
  const pending = preview.entries.filter(
    (entry) => (entry.source !== "auto" && entry.source !== "manual") || entry.reason.includes("重名") || entry.reason.includes("保留名")
  )
  for (const entry of pending) {
    const answer = await prompts({ name: "name", type: "text", message: `组「${entry.raw}」的模块名（留空保留 ${entry.fileName}）:` })
    const value = String(answer.name ?? "").trim()
    if (value) names[entry.raw] = value
  }
  if (Object.keys(names).length) grouping.names = names
  // 写入前校验：手工名非法或冲突时拒绝落盘
  const validation = applyGrouping(JSON.parse(JSON.stringify(spec)), grouping)
  if (validation.errors.length) {
    validation.errors.forEach((error) => console.error(`失败：${error}`))
    return 1
  }
  console.log("将写入：", JSON.stringify(grouping))
  const target = configFile ? path.resolve(configFile) : path.join(process.cwd(), CONFIG_PROJECT_FILE)
  writeConfig(target, { grouping })
  console.log(`已写入分组配置：${target}`)
  return 0
}

/** 接口面目标 */
interface SurfaceTarget {
  /** 目标 id（单目标为空） */
  id?: string
  /** 产物目录绝对路径 */
  dir: string
}

/**
 * 解析接口面命令的目标：多目标配置按 targets，单目标按 output.dir。
 * @param argv 参数列表
 * @return 目标与错误
 */
function resolveSurfaceTargets(argv: string[]) {
  const flags = getConfigFlags(argv)
  const layers = loadConfigLayers(process.cwd(), { projectFile: flags.configFile })
  layers.warnings.forEach((warning) => console.error(`⚠️ ${warning}`))
  const configDir = layers.project.file ? path.dirname(path.resolve(layers.project.file)) : process.cwd()
  const picked = pickTargetFlag(argv)
  if (picked.errors.length > 0) return { targets: [] as SurfaceTarget[], errors: picked.errors }
  if (hasTargets(layers.merged)) {
    if (String(flags.configFile ?? "").includes(",")) return { targets: [] as SurfaceTarget[], errors: ["多目标配置只接受单个 --config 文件"] }
    const plan = resolveTargets(layers.merged as Record<string, any>, { profile: flags.profile, configDir })
    plan.warnings.forEach((warning) => console.error(`⚠️ ${warning}`))
    if (plan.errors.length > 0) return { targets: [] as SurfaceTarget[], errors: plan.errors }
    if (picked.id && !plan.targets.some((target) => target.id === picked.id)) {
      return { targets: [] as SurfaceTarget[], errors: [`未知目标 ${picked.id}（可选：${plan.targets.map((target) => target.id).join("、")}）`] }
    }
    const selected = picked.id ? plan.targets.filter((target) => target.id === picked.id) : plan.targets
    return { targets: selected.map((target) => ({ id: target.id, dir: target.outputDir })), errors: [] as string[] }
  }
  if (picked.id) return { targets: [] as SurfaceTarget[], errors: ["当前配置没有 targets，--target 无法使用"] }
  const rc = applyEnvOverrides(normalizeConfig(applyProfile(normalizeConfig(layers.merged), flags.profile)))
  const output = rc.output
  const dir = typeof output === "string" ? output : output?.dir ?? "./src/api"
  return { targets: [{ dir: path.resolve(configDir, dir) }], errors: [] as string[] }
}

/**
 * 执行 surface：提取接口面、写基线或与基线比对。
 * @param argv 参数列表（测试可注入）
 * @return 退出码
 */
export async function runSurface(argv = process.argv.slice(2)) {
  const valueOf = (name: string) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const requestsOnly = argv.includes("--requests-only")
  const { targets, errors } = resolveSurfaceTargets(argv)
  if (errors.length > 0) {
    errors.forEach((error) => console.error("失败：", error))
    return 2
  }
  const missing = targets.filter((target) => !fs.existsSync(target.dir))
  if (missing.length > 0) {
    missing.forEach((target) => console.error(`失败：产物目录不存在：${target.dir}（先执行生成）`))
    return 1
  }
  const entries = targets.map((target) => ({ ...target, surface: collectSurface(target.dir, { requestsOnly }) }))
  const payload: SurfacePayload =
    entries.length === 1 && !entries[0].id
      ? { formatVersion: SURFACE_FORMAT_VERSION, ...entries[0].surface }
      : { formatVersion: SURFACE_FORMAT_VERSION, targets: Object.fromEntries(entries.map((entry) => [entry.id as string, entry.surface])) }
  const out = valueOf("--out")
  if (out) {
    const file = path.resolve(out)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
    console.log(`已写入：${file}`)
  }
  const compare = valueOf("--compare")
  if (compare) {
    const file = path.resolve(compare)
    if (!fs.existsSync(file)) {
      console.error(`失败：基线文件不存在：${file}`)
      return 1
    }
    let baseline: SurfacePayload
    try {
      baseline = JSON.parse(fs.readFileSync(file, "utf8"))
    } catch (error) {
      console.error(`失败：基线解析失败：${(error as Error).message}`)
      return 1
    }
    const diff = compareSurface(payload, baseline, { requestsOnly })
    if (diff.errors.length > 0 || diff.lines.length > 0) {
      diff.errors.forEach((error) => console.error(`✖ ${error}`))
      diff.lines.forEach((line) => console.log(line))
      console.error(`✖ 接口面与基线不一致：${diff.errors.length} 项结构变化，${diff.lines.length} 项增删`)
      return 1
    }
    console.log("校验：接口面与基线一致")
    return 0
  }
  if (argv.includes("--json")) {
    writeJson(payload)
    return 0
  }
  entries.forEach((entry) => {
    const label = entry.id ? `接口面[${entry.id}]：` : "接口面："
    console.log(`${label}${entry.surface.requests.length} 个接口 / ${entry.surface.types.length} 个类型 → ${entry.dir}`)
  })
  return 0
}

/**
 * 执行 inspect：只读审计产物目录的模块布局。
 * @param argv 参数列表（测试可注入）
 * @return 退出码
 */
export function runInspect(argv = process.argv.slice(2)) {
  const valueOf = (name: string) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const dir = valueOf("--dir")
  if (!dir) return diagnosticError(argv, "inspect", "E_ARGS_MISSING", "inspect 需要 --dir <产物目录>", ["swagger2api inspect --dir ./src/api"])
  const thresholds = resolveInspectThresholds({ projectFile: valueOf("--config") })
  const target = path.resolve(dir)
  let report
  try {
    report = inspectLayout(target, thresholds)
  } catch (error) {
    return diagnosticError(argv, "inspect", "E_DIR_NOT_FOUND", (error as Error).message, [`swagger2api inspect --dir "${dir}" --json # 确认目录存在后重试`])
  }
  const actions = report.issues.length
    ? ["swagger2api --dry-run --json # 预览分桶与分片规划", `swagger2api inspect --dir "${target}" --strict # 让布局异常直接失败`]
    : []
  if (argv.includes("--json")) {
    writeJson({
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      toolVersion: readToolVersion(),
      command: "inspect",
      ok: report.issues.length === 0,
      errorCode: report.issues.length ? "E_LAYOUT_ISSUES" : null,
      actions,
      ...report
    })
  } else {
    formatInspectReport(report).forEach((line) => console.log(line))
  }
  if (report.issues.length && argv.includes("--strict")) {
    console.error(`✖ 布局异常 ${report.issues.length} 项`)
    return 1
  }
  return 0
}

/**
 * prune 目标校验：仓库根、当前目录的祖先、配置目录与软链接目录一律拒绝。
 * @param target 目标目录绝对路径
 * @return 拒绝原因；安全时返回 null
 */
function pruneBlockedReason(target: string) {
  const cwd = path.resolve(process.cwd())
  const rel = path.relative(target, cwd)
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return `目录 ${target} 是仓库根或当前目录的祖先，拒绝清理`
  if (fs.lstatSync(target).isSymbolicLink()) return `目录 ${target} 是软链接，拒绝清理（请直接指定真实产物目录）`
  // 仓库根与配置目录可能混放手写文件与多份产物，只允许指定具体产物目录
  if (fs.existsSync(path.join(target, ".git"))) return `目录 ${target} 是仓库根，拒绝清理`
  const names = fs.readdirSync(target)
  if (names.some((name) => /^(?:swagger2api(?:\.[^./\\]+)?|saconfig.*)\.json$/i.test(name))) {
    return `目录 ${target} 是配置目录，拒绝清理；请指定具体产物目录`
  }
  return null
}

/**
 * 执行 prune：只读优先地清理废弃产物目录中的生成物，默认只列不删。
 * @param argv 参数列表（测试可注入）
 * @return 退出码
 */
export function runPrune(argv = process.argv.slice(2)) {
  const valueOf = (name: string) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const dir = valueOf("--dir")
  if (!dir) return diagnosticError(argv, "prune", "E_ARGS_MISSING", "prune 需要 --dir <产物目录>", ["swagger2api prune --dir ./src/api --json # 先预览"])
  const target = path.resolve(dir)
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    return diagnosticError(argv, "prune", "E_DIR_NOT_FOUND", `目录不存在：${target}`, [`swagger2api prune --dir "${target}" --json # 确认目录存在后重试`])
  }
  const blocked = pruneBlockedReason(target)
  if (blocked) return diagnosticError(argv, "prune", "E_UNSAFE_DIR", blocked, ["swagger2api prune --dir ./src/api/old --json # 指定具体产物目录后再预览"])
  const execute = argv.includes("--yes")
  const files = collectGeneratedFilesOf(target)
  // 先列后删：默认语义即预览，必须显式 --yes 才落删
  if (execute) for (const file of files) fs.rmSync(path.join(target, file))
  if (argv.includes("--json")) {
    writeJson({
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      toolVersion: readToolVersion(),
      command: "prune",
      ok: true,
      errorCode: null,
      dir: target,
      dryRun: !execute,
      files,
      actions: !execute && files.length ? [`swagger2api prune --dir "${target}" --yes # 删除前需用户确认`] : []
    })
    return 0
  }
  if (files.length === 0) {
    console.log(`未发现生成物：${target}`)
    return 0
  }
  files.forEach((file) => console.log(`${execute ? "已删除" : "待删除"}：${path.resolve(target, file)}`))
  console.log(execute ? `prune 完成：删除 ${files.length} 个生成物` : `prune 预览：${files.length} 个生成物待删除（加 --yes 执行）`)
  return 0
}

/**
 * 打印简要用法：只列入口命令，完整参数见 docs/cli.md。
 * @return 无
 */
function printUsage() {
  console.log(
    [
      "用法：",
      "  swagger2api                         按最近的 swagger2api.json 生成",
      "  swagger2api --target <id>           多目标配置下只生成指定目标",
      "  swagger2api --check                 校验产物与配置是否一致",
      "  swagger2api init                    交互生成配置（--from-script 迁移旧脚本）",
      "  swagger2api grouping                查看分组分布并写入分组配置",
      "  swagger2api config status           查看配置分层与生效结果",
      "  swagger2api surface [选项]          提取接口面或与基线比对",
      "  swagger2api inspect --dir <目录>    只读审计产物布局（模块体量 / 固定产物 / 小文件）",
      "  swagger2api prune --dir <目录>      清理废弃目录中的生成物（默认只列，--yes 才删）",
      "  swagger2api skill [--print|--json]  输出包内 AI 技能入口",
      "",
      "首次接入或迁移配置时读取技能：pnpm exec swagger2api skill --print",
      "日常生成与 --check 不需要加载技能。",
      "非交互环境（AI / CI）一律显式传 --config，不要依赖交互提问。",
      "版本：swagger2api --version"
    ].join("\n")
  )
}

/**
 * 包根目录：从模块位置向上找到 name 为 @fxri/swagger2api 的 package.json。
 * 本地源码与 dist 产物两种位置都适用，不依赖当前工作目录。
 * @return 包根绝对路径
 */
function resolvePackageRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const file = path.join(dir, "package.json")
    if (fs.existsSync(file)) {
      try {
        if (JSON.parse(fs.readFileSync(file, "utf8")).name === "@fxri/swagger2api") return dir
      } catch {
        // 非法 JSON 视为非目标包，继续向上
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error("未能定位 @fxri/swagger2api 包根目录")
}

/**
 * 解析包内技能入口与版本。
 * @param root 包根绝对路径
 * @return 入口、references 目录与技能版本
 */
function resolveSkillInfo(root: string) {
  const skillDir = path.join(root, "skills", "fxri-swagger2api")
  const entry = path.join(skillDir, "SKILL.md")
  const referencesDir = path.join(skillDir, "references")
  let version = ""
  if (fs.existsSync(entry)) {
    const content = fs.readFileSync(entry, "utf8")
    version = /^[ \t]+version:[ \t]*"?([^"\r\n]+?)"?[ \t]*$/m.exec(content)?.[1]?.trim() ?? ""
  }
  return { entry, referencesDir, version }
}

/**
 * 执行 skill：只读输出包内技能入口，不写文件、不维护状态。
 * @param argv 参数列表（测试可注入）
 * @return 退出码
 */
export function runSkill(argv = process.argv.slice(2)) {
  const print = argv.includes("--print")
  const json = argv.includes("--json")
  if (print && json) {
    console.error("⚠️ --print 与 --json 不能同时使用")
    return 1
  }
  const info = resolveSkillInfo(resolvePackageRoot())
  if (!fs.existsSync(info.entry)) {
    console.error(`⚠️ 包内未找到技能入口：${info.entry}`)
    return 1
  }
  if (print) {
    const content = fs.readFileSync(info.entry, "utf8")
    process.stdout.write(content.endsWith("\n") ? content : `${content}\n`)
    return 0
  }
  if (json) {
    writeJson(info)
    return 0
  }
  console.log(info.entry)
  return 0
}

/**
 * CLI 入口分发：默认生成，识别 init / config status / grouping / skill。
 * @param runGenerate 默认生成逻辑
 * @return 无
 */
export async function dispatch(runGenerate: () => Promise<void>) {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage()
    return
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    // 纯文本一行，便于 CI 与 AI 在日志里记录实际使用的版本
    console.log(readToolVersion())
    return
  }
  const [command, subcommand] = argv.filter((item) => !item.startsWith("-"))
  if (command === "init") {
    process.exitCode = await runInit()
    return
  }
  if (command === "grouping") {
    process.exitCode = await runGrouping()
    return
  }
  if (command === "config" && subcommand === "status") {
    process.exitCode = runConfigStatus()
    return
  }
  if (command === "surface") {
    process.exitCode = await runSurface()
    return
  }
  if (command === "inspect") {
    process.exitCode = runInspect()
    return
  }
  if (command === "prune") {
    process.exitCode = runPrune()
    return
  }
  if (command === "skill") {
    process.exitCode = runSkill()
    return
  }
  await runGenerate()
}
