---
"@fxri/swagger2api": patch
---

- 优化：统一 package.json 元数据，补齐 publishConfig.access、repository 的 git+ 前缀、文档站 homepage 与 keywords，engines 对齐 node >=20.19.0，bin 改为对象形式
- 优化：tasks、changeset 等脚本改为经包装脚本调用全局 toolkit，未安装时跳过、设置 FX_REQUIRE_TOOLKIT=1 时失败
