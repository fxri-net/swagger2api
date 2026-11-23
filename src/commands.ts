import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import axios from "axios"
import {
  CONFIG_ENV_OVERRIDES,
  CONFIG_LOCAL_FILE,
  CONFIG_PROJECT_FILE,
  applyEnvOverrides,
  applyProfileToBase,
  describeLayers,
  getConfigFlags,
  loadConfigLayers,
  mergeShallow
} from "./utils/config"
import { pickDocFlags, resolveDocs } from "./utils/docs"
import { PromptCancelled, askConfirm, askNumber, askSelect, askText } from "./utils/cli-ui"
import { SURFACE_FORMAT_VERSION, collectSurface, compareSurface, type SurfacePayload } from "./utils/surface"
import { formatInspectReport, inspectLayout, resolveInspectThresholds } from "./utils/inspect"
import { parseUpgradeOptions, runUpgrade } from "./utils/upgrade"
import { applyGrouping, type GroupingConfig, type GroupingRule } from "./utils/grouping"
import { DIAGNOSTIC_SCHEMA_VERSION, canPrompt, normalizeTimeout, readToolVersion, writeJson } from "./utils"
import { COMMAND_CAPABILITIES, CONFIG_KEYS, EXIT_CODES, SKILL_REFERENCES } from "./utils/capabilities"
import { collectGeneratedFilesOf } from "./utils/modular"
import { stringifyConfig, stripDefaults } from "./utils/config-format"

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
const GITIGNORE_ROWS = [CONFIG_LOCAL_FILE, ".swagger2api/backup/"]

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
  fs.writeFileSync(file, stringifyConfig(stripDefaults(merged)))
}

/**
 * 只更新指定文档项：其余文档、base 与未知字段保持原样。
 * @param file 配置路径
 * @param id 文档 id
 * @param patch 待写入的文档字段
 * @return 无
 */
function writeDocPatch(file: string, id: string, patch: Record<string, any>) {
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
  const docs: Array<Record<string, any>> = Array.isArray(existing.docs) ? existing.docs : []
  const index = docs.findIndex((item) => item && item.id === id)
  if (index === -1) docs.push({ id, ...patch })
  else docs[index] = { ...docs[index], ...patch }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, stringifyConfig(stripDefaults({ ...existing, docs })))
}

/**
 * 交互式收集配置。
 * @return 配置段
 */
async function askConfig() {
  const id = await askText("文档 id:", "main")
  const source = await askText("Swagger 地址或本地文件:", "")
  const dir = await askText("输出目录:", "./src/api")
  const name = await askText("入口文件名:", "index")
  const client = await askSelect(
    "HTTP 客户端:",
    [
      { label: "axios", value: "axios" },
      { label: "fetch", value: "fetch" }
    ],
    "axios"
  )
  const language = await askSelect(
    "输出语言:",
    [
      { label: "TypeScript", value: "ts" },
      { label: "JavaScript", value: "js" }
    ],
    "ts"
  )
  const responses = await askConfirm("生成响应类型信息?", true)
  const grouped = await askConfirm("按组拆分为多文件?", false)
  return {
    base: {
      output: { name, mode: grouped ? "grouped" : "single" },
      client,
      language,
      types: { responses }
    },
    docs: [{ id: id || "main", source, output: dir }]
  }
}

/**
 * 执行 init：交互向导或从既有脚本迁移。
 * @return 退出码
 */
export async function runInit() {
  const argv = process.argv.slice(2)
  const targetIndex = argv.findIndex((item) => item === "--config" || item === "-c")
  const targetFile = targetIndex === -1 ? path.join(process.cwd(), CONFIG_PROJECT_FILE) : path.resolve(argv[targetIndex + 1])

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
  const merged = layers.merged ?? {}
  // 环境变量按文档生效，状态展示先把 base 按预设与环境变量展开，docs 原样列出
  const base = applyEnvOverrides(applyProfileToBase(merged.base, merged.profiles, profile))
  const effective = { base, docs: merged.docs ?? [], profiles: merged.profiles ?? {} }
  const payload = {
    layers: describeLayers(layers),
    envOverrides: CONFIG_ENV_OVERRIDES.filter((item) => process.env[item.env] !== undefined).map((item) => `${item.env} → ${item.key}`),
    profile: profile ?? null,
    effective,
    warnings: layers.warnings,
    errors: layers.errors
  }
  if (process.argv.includes("--json")) {
    writeJson(payload)
  } else {
    payload.layers.forEach((line) => console.log(line))
    payload.envOverrides.length ? console.log(`环境变量：${payload.envOverrides.join("；")}`) : console.log("环境变量：无")
    console.log(`预设：${payload.profile ?? "未指定"}`)
    payload.warnings.forEach((warning) => console.error(`⚠️ ${warning}`))
    payload.errors.forEach((error) => console.error(`失败：${error}`))
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
  layers.warnings.forEach((warning) => console.error(`⚠️ ${warning}`))
  if (layers.errors.length > 0) {
    layers.errors.forEach((error) => console.error(`失败：${error}`))
    return 2
  }
  if (!layers.merged) {
    console.error("失败：未找到 swagger2api.json；请先执行 swagger2api init")
    return 2
  }
  const configDir = layers.project.file ? path.dirname(path.resolve(layers.project.file)) : process.cwd()
  const plan = resolveDocs(layers.merged, { profile, configDir })
  plan.warnings.forEach((warning) => console.error(`⚠️ ${warning}`))
  if (plan.errors.length > 0) {
    plan.errors.forEach((error) => console.error(`失败：${error}`))
    return 2
  }
  const picked = pickDocFlags()
  if (picked.errors.length > 0) {
    picked.errors.forEach((error) => console.error(`失败：${error}`))
    return 2
  }
  const ids = plan.docs.map((doc) => doc.id)
  if (picked.ids.length !== 1) {
    console.error(`失败：grouping 需要用 --target 指定一个文档 id（可选：${ids.join("、")}）`)
    return 2
  }
  const doc = plan.docs.find((item) => item.id === picked.ids[0])
  if (!doc) {
    console.error(`失败：未知文档 ${picked.ids[0]}（可选：${ids.join("、")}）`)
    return 2
  }
  const rc = doc.config
  let spec: Record<string, any>
  try {
    const timeout = normalizeTimeout(rc.input?.timeout, "input.timeout")
    spec = await loadSpec(doc.input, timeout)
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
  const strategy = await askSelect(
    "分组依据：",
    [
      { label: "按标签（tag）", value: "tag" },
      { label: "按路径段", value: "path" },
      { label: "按显式规则（稍后在配置里补）", value: "rules" }
    ],
    "tag"
  )
  const pathDepth = await askNumber("路径段深度（按路径分组时生效）:", 0)
  const fallback = await askText("兜底组名:", "misc")
  const rules: GroupingRule[] = []
  if (strategy === "rules") {
    // 规则编辑：循环录入「匹配方式 + 匹配值 + 组名」，可直接回车结束
    let more = true
    while (more) {
      const kind = await askSelect(
        "规则匹配方式：",
        [
          { label: "路径前缀", value: "prefix" },
          { label: "标签", value: "tag" }
        ],
        "prefix"
      )
      const value = await askText("匹配值（留空结束）：")
      const group = await askText("归入组名：")
      if (!value || !group) break
      rules.push({ match: { [kind]: value } as GroupingRule["match"], group })
      more = await askConfirm("继续添加规则？", false)
    }
  }
  const grouping: GroupingConfig = {
    strategy: [strategy],
    pathDepth,
    rules,
    fallback: fallback || "misc",
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
    const answer = await askText(`组「${entry.raw}」的模块名（留空保留 ${entry.fileName}）:`)
    if (answer.trim()) names[entry.raw] = answer.trim()
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
  // 只改被检查的文档项，其余文档与共享配置保持原样
  writeDocPatch(target, doc.id, { grouping })
  console.log(`已写入分组配置：${target}（文档 ${doc.id}）`)
  return 0
}

/** 接口面目标 */
interface SurfaceTarget {
  /** 文档 id（单文档时为空，保持基线平铺） */
  id?: string
  /** 产物目录绝对路径 */
  dir: string
}

/**
 * 解析接口面命令的目标：按文档列表取产物目录，--target 过滤。
 * @param argv 参数列表
 * @return 目标与错误
 */
function resolveSurfaceTargets(argv: string[]) {
  const flags = getConfigFlags(argv)
  const layers = loadConfigLayers(process.cwd(), { projectFile: flags.configFile })
  layers.warnings.forEach((warning) => console.error(`⚠️ ${warning}`))
  if (layers.errors.length > 0) return { targets: [] as SurfaceTarget[], errors: layers.errors }
  if (!layers.merged) return { targets: [] as SurfaceTarget[], errors: ["未找到 swagger2api.json；请先执行 swagger2api init"] }
  const configDir = layers.project.file ? path.dirname(path.resolve(layers.project.file)) : process.cwd()
  const picked = pickDocFlags(argv)
  if (picked.errors.length > 0) return { targets: [] as SurfaceTarget[], errors: picked.errors }
  const plan = resolveDocs(layers.merged, { profile: flags.profile, configDir })
  plan.warnings.forEach((warning) => console.error(`⚠️ ${warning}`))
  if (plan.errors.length > 0) return { targets: [] as SurfaceTarget[], errors: plan.errors }
  if (picked.ids.length > 0) {
    const unknown = picked.ids.filter((id) => !plan.docs.some((doc) => doc.id === id))
    if (unknown.length > 0) return { targets: [] as SurfaceTarget[], errors: [`未知文档 ${unknown.join("、")}（可选：${plan.docs.map((doc) => doc.id).join("、")}）`] }
  }
  const selected = picked.ids.length > 0 ? plan.docs.filter((doc) => picked.ids.includes(doc.id)) : plan.docs
  // 单文档保持平铺基线，多文档按 id 分组
  return { targets: selected.map((doc) => ({ id: plan.docs.length > 1 ? doc.id : undefined, dir: doc.outputDir })), errors: [] as string[] }
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
  if (names.some((name) => /^swagger2api(?:\.local)?\.json$/i.test(name))) {
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
      "  swagger2api                         单文档直接生成；多文档交互选择",
      "  swagger2api --target <id[,id]>      只生成指定文档（可逗号多选）",
      "  swagger2api --all                   生成全部文档（多文档非交互必需）",
      "  swagger2api --dry-run [--json]      只输出分组报表，不写产物",
      "  swagger2api --check                 校验产物与配置是否一致",
      "  swagger2api init                    交互生成配置（--from-script 走 upgrade --yes）",
      "  swagger2api upgrade [选项]          迁移旧配置与脚本（--dry-run / --diff / --yes / --restore）",
      "  swagger2api grouping                查看分组分布并写入分组配置",
      "  swagger2api config status           查看配置分层与生效结果",
      "  swagger2api surface [选项]          提取接口面或与基线比对",
      "  swagger2api inspect --dir <目录>    只读审计产物布局（模块体量 / 固定产物 / 小文件）",
      "  swagger2api prune --dir <目录>      清理废弃目录中的生成物（默认只列，--yes 才删）",
      "  swagger2api capabilities [--json]   输出能力清单（命令 / 配置项 / 退出码）",
      "  swagger2api skill [--print|--json]  输出包内 AI 技能入口",
      "  swagger2api --version               输出版本号",
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
    writeJson({ ...info, references: SKILL_REFERENCES })
    return 0
  }
  console.log(info.entry)
  return 0
}

/**
 * 执行 capabilities：只读输出能力清单，供 AI 在不熟悉版本时自描述。
 * @param argv 参数列表（测试可注入）
 * @return 退出码
 */
export function runCapabilities(argv = process.argv.slice(2)) {
  if (argv.includes("--json")) {
    const info = resolveSkillInfo(resolvePackageRoot())
    writeJson({
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      toolVersion: readToolVersion(),
      commands: COMMAND_CAPABILITIES,
      configKeys: CONFIG_KEYS,
      exitCodes: EXIT_CODES,
      skill: { entry: info.entry, version: info.version, references: SKILL_REFERENCES }
    })
    return 0
  }
  console.log("能力清单（--json 输出结构化内容）：")
  COMMAND_CAPABILITIES.forEach((item) => {
    const mode = item.readOnly ? "只读" : item.destructive ? "破坏性" : "写入"
    console.log(`  ${item.id.padEnd(13)} ${mode}  ${item.name.padEnd(32)} ${item.purpose}`)
  })
  console.log(`退出码：${EXIT_CODES.map((item) => `${item.code}=${item.description}`).join("；")}`)
  console.log("结构化输出：swagger2api capabilities --json")
  return 0
}

/**
 * 交互命令包装：ESC / Ctrl+C 统一以 130 结束，不打印堆栈。
 * @param run 命令实现
 * @return 退出码
 */
async function runInteractive(run: () => Promise<number>) {
  try {
    return await run()
  } catch (error) {
    if (error instanceof PromptCancelled) {
      console.log("已取消")
      return 130
    }
    throw error
  }
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
    // 兼容别名：init --from-script 统一走 upgrade --yes，避免两套迁移行为
    const scriptIndex = argv.findIndex((item) => item === "--from-script")
    if (scriptIndex !== -1) {
      const pkg = path.resolve(argv[scriptIndex + 1] ?? "package.json")
      process.exitCode = await runInteractive(() => runUpgrade({ ...parseUpgradeOptions(argv), cwd: path.dirname(pkg), yes: true }))
      return
    }
    process.exitCode = await runInteractive(runInit)
    return
  }
  if (command === "grouping") {
    process.exitCode = await runInteractive(runGrouping)
    return
  }
  if (command === "upgrade") {
    process.exitCode = await runInteractive(() => runUpgrade(parseUpgradeOptions(argv)))
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
  if (command === "capabilities") {
    process.exitCode = runCapabilities()
    return
  }
  await runGenerate()
}
