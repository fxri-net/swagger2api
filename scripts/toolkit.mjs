// 仅调用全局 toolkit：存在则执行并透传退出码，缺失时默认跳过；设置 FX_REQUIRE_TOOLKIT=1 可改为失败
import { spawnSync } from "node:child_process"

const isWindows = process.platform === "win32"
const args = process.argv.slice(2)

/**
 * 调用全局 toolkit：Windows 下是 .cmd，须经 cmd.exe。
 * 用 /d /s /c 加参数数组交给 Node 转义——既不触发 node24 的 DEP0190，也不把用户参数拼进命令字符串。
 * @param {string[]} argv 参数
 * @param {object} options spawnSync 选项
 * @return {object} 子进程结果
 */
function spawnToolkit(argv, options = {}) {
  if (isWindows) return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "toolkit", ...argv], options)
  return spawnSync("toolkit", argv, options)
}

// 先探测全局命令，避免直接执行时输出 shell 的“找不到命令”噪音
const probe = spawnToolkit(["--version"], { encoding: "utf8" })
if (probe.status !== 0) {
  const message = `⚠️ 未检测到全局 toolkit，跳过：toolkit ${args.join(" ")}`
  if (process.env.FX_REQUIRE_TOOLKIT === "1") {
    console.error(message)
    process.exit(1)
  }
  console.warn(message)
  process.exit(0)
}

const result = spawnToolkit(args, { stdio: "inherit" })
process.exit(result.status ?? 1)
