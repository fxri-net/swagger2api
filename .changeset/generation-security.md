---
"@fxri/swagger2api": minor
---

- 修复：把官方 13.12.2 的代码注入与 SSRF 修复回移到本工具生成链（路径、枚举、默认值、servers 地址转义）
- 新增：外部 `$ref` 按官方策略校验（同源放行、其余仅公网 http(s)、逐跳校验重定向、拒绝私网与回环），不合规直接报错
- 修改：生成失败不再静默——存在不合规文档时以非 0 退出，并在 stderr 指出被忽略的文档
- 优化：补充 `swagger-typescript-api` 的最小类型声明与 `package.json` 的 `types` 入口
- 新增：注入与私网引用夹具，并在 `pnpm verify` 增加安全夹具步骤
