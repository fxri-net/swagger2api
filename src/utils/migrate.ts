import fs from "node:fs"
import path from "node:path"

// 存量迁移：把 package.json 里 npm script 中的 swagger2api 参数解析成配置对象。
// 只做确定性映射，遇到无法识别的参数不猜——原样放入 unknown 由调用方提示。

/** 迁移结果 */
export interface ScriptMigrateResult {
  /** 解析出的配置 */
  config: Record<string, any>
  /** 无法识别的参数 */
  unknown: string[]
  /** 命中的脚本名 */
  scriptName: string
}

/**
 * 按 shell 习惯切分参数（支持双引号、单引号与反斜杠转义）。
 * @param input 原始命令行片段
 * @return 参数数组
 */
export function tokenizeArgs(input: string) {
  const args: string[] = []
  let current = ""
  let quote: '"' | "'" | null = null
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quote) {
      if (char === "\\" && quote === '"' && index + 1 < input.length) {
        current += input[index + 1]
        index += 1
      } else if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
    } else if (/\s/.test(char)) {
      if (current) args.push(current)
      current = ""
    } else {
      current += char
    }
  }
  if (current) args.push(current)
  return args
}

/**
 * 把参数数组映射为配置对象。
 * @param args swagger2api 之后的参数
 * @return 配置与未识别项
 */
export function argsToConfig(args: string[]) {
  const config: Record<string, any> = {}
  const unknown: string[] = []
  const set = (section: string, key: string, value: unknown) => {
    config[section] = config[section] ?? {}
    config[section][key] = value
  }
  const pairs: Record<string, () => void> = {
    "--axios": () => set("client", "type", "axios"),
    "--responses": () => set("types", "responses", true),
    "-r": () => set("types", "responses", true),
    "--js": () => set("language", "target", "js"),
    "-cg": () => set("naming", "convertGetToQuery", true),
    "--convert-get": () => set("naming", "convertGetToQuery", true),
    "-rp": () => set("naming", "dropPathParams", true),
    "--remove-param": () => set("naming", "dropPathParams", true),
    "-err": () => set("types", "extractResponseRaw", true),
    "--extract-response-raw": () => set("types", "extractResponseRaw", true),
    "-rd": () => set("types", "removeDts", true),
    "--remove-dts": () => set("types", "removeDts", true),
    "--modular": () => set("output", "mode", "grouped"),
    "--clean-output": () => set("output", "clean", true),
    "--prune": () => set("output", "prune", true)
  }
  const valueFlags: Record<string, (value: string) => void> = {
    "-rpi": (value) => set("naming", "pathPrefixIndex", Number(value)),
    "--remove-prefix-index": (value) => set("naming", "pathPrefixIndex", Number(value)),
    "-erq": (value) => set("types", "extractQuery", value),
    "--extract-request-query": (value) => set("types", "extractQuery", value),
    "--module-name-index": (value) => set("grouping", "pathDepth", Number(value)),
    "--url": (value) => set("input", "url", value),
    "--output": (value) => set("output", "dir", value),
    "--name": (value) => set("output", "name", value),
    "--language": (value) => set("language", "target", value),
    "--client": (value) => set("client", "type", value),
    "--type-check": (value) => set("output", "typeCheck", value),
    "--query": (value) => set("types", "extractQuery", value),
    "--timeout": (value) => set("input", "timeout", Number(value)),
    "--banner": (value) => set("output", "banner", value)
  }
  /** 仅工具自身使用、不进入配置的参数 */
  const ignored = new Set([
    "--config",
    "-c",
    "--quick",
    "-q",
    "--json",
    "--check",
    "--dry-run",
    "--yes",
    "--all",
    "--no-interactive",
    "--keep-legacy"
  ])
  /** 带值但不是配置项的参数 */
  const valueIgnored = new Set(["--profile", "--target", "--cwd", "--only", "--skip", "--restore"])
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    // shell 占位符与工具自身参数不属于配置项
    if (arg === "$1") continue
    if (ignored.has(arg)) {
      if (arg === "--config" || arg === "-c") index += 1
      continue
    }
    if (valueIgnored.has(arg)) {
      index += 1
      continue
    }
    if (arg === "-rt" || arg === "--replace-tags") {
      const source = args[index + 1]
      const target = args[index + 2] ?? ""
      if (source !== undefined) {
        set("naming", "tagRewrite", [source, target])
        index += 2
        continue
      }
    }
    if (valueFlags[arg]) {
      valueFlags[arg](args[index + 1] ?? "")
      index += 1
      continue
    }
    if (pairs[arg]) {
      pairs[arg]()
      continue
    }
    // 已是识别的长参数形式之外的值（通常是上一个参数的值）跳过
    if (arg.startsWith("-")) unknown.push(arg)
  }
  return { config, unknown }
}

/**
 * 从 package.json 的脚本里提取 swagger2api 参数并转成配置。
 * @param packageFile package.json 路径
 * @param scriptName 指定脚本名（默认查找第一个包含 swagger2api 的脚本）
 * @return 迁移结果
 */
export function migrateFromPackage(packageFile: string, scriptName?: string): ScriptMigrateResult {
  const absolute = path.resolve(packageFile)
  const pkg = JSON.parse(fs.readFileSync(absolute, "utf8"))
  const scripts: Record<string, string> = pkg.scripts ?? {}
  const entries = Object.entries(scripts).filter(([, command]) => typeof command === "string" && command.includes("swagger2api"))
  if (entries.length === 0) throw new Error(`未在 ${absolute} 中找到包含 swagger2api 的脚本`)
  const chosen = scriptName ? entries.find(([name]) => name === scriptName) : entries[0]
  if (!chosen) throw new Error(`${absolute} 中不存在脚本 ${scriptName}`)
  const [name, command] = chosen
  const tokens = tokenizeArgs(command)
  const start = tokens.findIndex((token) => token.endsWith("swagger2api") || token === "swagger2api")
  const args = start === -1 ? tokens : tokens.slice(start + 1)
  const { config, unknown } = argsToConfig(args)
  return { config, unknown, scriptName: name }
}
