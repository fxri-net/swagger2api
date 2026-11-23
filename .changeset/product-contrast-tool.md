---
"@fxri/swagger2api": patch
---

- 新增：本仓本地验证脚本 `scripts/product-contrast.mjs`，同一份 swagger 快照分别用旧版与当前 CLI 生成并比对导出契约与业务调用点
- 新增：比对脚本的 `--snapshot` 阶段，从配置 `source` 拉取快照（含凭据地址由 axios 转 Basic，日志只输出脱敏地址），生成前校验快照齐备，报告记录快照字节数与 sha256 指纹
- 文档：README / AGENTS 补充脚本用法，FAQ 补充升级前接口面比对方法
