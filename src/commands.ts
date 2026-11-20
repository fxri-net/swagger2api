import fs from "node:fs"
import path from "node:path"
import prompts from "prompts"
import {
  CONFIG_ENV_OVERRIDES,
  CONFIG_PROJECT_FILE,
  applyEnvOverrides,
  applyProfile,
  describeLayers,
  getConfigFlags,
  loadConfigLayers,
  mergeShallow
} from "./utils/config"
import { migrateFromPackage } from "./utils/migrate"

/** .gitignore 片段标识：认领本工具写入的注释行，重跑时据此改写 */
const GITIGNORE_MARKER = "# @fxri/swagger2api"
/** .gitignore 片段内容 */
const GITIGNORE_ROWS = ["*.swagger2apirc.local.json"]

/**
 * 写入受管的 .gitignore 片段（幂等）。
 * @param dir 目录
 * @return 无
 */
function ensureGitignore(dir: string) {
  const file = path.join(dir, ".gitignore")
  const rows = [`${GITIGNORE_MARKER} 个人配置不入库`, ...GITIGNORE_ROWS]
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  if (existing.includes(GITIGNORE_MARKER)) return
  const content = existing && !existing.endsWith("\n") ? `${existing}\n` : existing
  fs.writeFileSync(file, `${content}${rows.join("\n")}\n`)
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
 * CLI 入口分发：默认生成，识别 init / config status。
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
  if (command === "config" && subcommand === "status") {
    process.exitCode = runConfigStatus()
    return
  }
  await runGenerate()
}
