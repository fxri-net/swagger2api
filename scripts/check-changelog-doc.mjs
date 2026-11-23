// 本地 CHANGELOG 镜像检查：全局 toolkit 可用时执行 --check，未安装时打印跳过（远程 CI 不依赖该工具）
import { spawnSync } from "node:child_process"

const isWindows = process.platform === "win32"

/**
 * 运行 toolkit：Windows 下是 .cmd，必须经 shell；按单条命令字符串传入以避开 node24 的 DEP0190。
 * ⚠️ 仅用于参数为内部常量的调用。
 * @param {string[]} args 参数
 * @param {object} options spawnSync 选项
 * @return {object} 子进程结果
 */
function spawnToolkit(args, options = {}) {
  if (isWindows) return spawnSync(["toolkit", ...args].join(" "), { ...options, shell: true })
  return spawnSync("toolkit", args, options)
}

const probe = spawnToolkit(["--version"], { encoding: "utf8" })
if (probe.status !== 0) {
  console.log("跳过 CHANGELOG 镜像检查（未检测到全局 toolkit）")
  process.exit(0)
}

const result = spawnToolkit(["release", "mirror", "--check"], {
  stdio: "inherit",
})
process.exit(result.status ?? 1)
