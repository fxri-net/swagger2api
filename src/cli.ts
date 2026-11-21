import { generateApi } from "./index"
import { dispatch } from "./commands"

// JSON 模式：人类日志统一走 stderr，stdout 只保留结构化结果
if (process.argv.includes("--json")) {
  console.log = (...args: unknown[]) => console.error(...args)
}

// CLI 入口：默认生成；init / config status 为子命令，旧参数调用保持原行为
void dispatch(generateApi)
