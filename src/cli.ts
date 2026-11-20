import { generateApi } from "./index"
import { dispatch } from "./commands"

// CLI 入口：默认生成；init / config status 为子命令，旧参数调用保持原行为
void dispatch(generateApi)
