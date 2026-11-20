import fs from "node:fs"
import path from "node:path"
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
  mergeShallow
} from "./utils/config"
import { migrateFromPackage } from "./utils/migrate"
import { applyGrouping, type GroupingConfig, type GroupingRule } from "./utils/grouping"

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

  if (!process.stdout.isTTY) {
    console.error("init 需要交互式终端；非交互环境请使用 --from-script 或手写配置文件")
    return 1
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
    console.log(JSON.stringify(payload, null, 2))
  } else {
    payload.layers.forEach((line) => console.log(line))
    payload.envOverrides.length ? console.log(`环境变量：${payload.envOverrides.join("；")}`) : console.log("环境变量：无")
    console.log(`预设：${payload.profile ?? "未指定"}`)
    payload.warnings.forEach((warning) => console.error(`⚠️ ${warning}`))
  }
  return 0
}

/**
 * 加载 swagger 文档（本地文件或 http(s) 地址）。
 * @param input 地址或路径
 * @return 文档对象
 */
async function loadSpec(input: string) {
  if (/^https?:\/\//i.test(input)) return (await axios.get(input)).data
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
    spec = await loadSpec(input)
  } catch (error) {
    console.error(`读取文档失败：${(error as Error).message}`)
    return 1
  }
  const stats = collectStats(spec)
  console.log(`共 ${stats.total} 个接口`)
  console.log("按标签分布：", ...Object.entries(stats.tags).map(([tag, count]) => `${tag}-${count}`))
  console.log("按路径首段分布：", ...Object.entries(stats.prefixes).map(([prefix, count]) => `${prefix}-${count}`))

  if (!process.stdout.isTTY) {
    console.log("非交互终端：仅输出报表，分组规则请直接写入配置文件的 grouping 段")
    return 0
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
    { name: "minRoutes", type: "number", message: "少于多少接口并入兜底组:", initial: 0 },
    { name: "maxRoutes", type: "number", message: "多于多少接口再拆一层（0 表示不拆）:", initial: 0 },
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
    minRoutes: Number(answers.minRoutes ?? 0),
    maxRoutes: Number(answers.maxRoutes ?? 0),
    fallback: answers.fallback || "misc",
    preserveTags: true
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

/**
 * CLI 入口分发：默认生成，识别 init / config status / grouping。
 * @param runGenerate 默认生成逻辑
 * @return 无
 */
export async function dispatch(runGenerate: () => Promise<void>) {
  const argv = process.argv.slice(2)
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
  await runGenerate()
}
