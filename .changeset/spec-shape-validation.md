---
"@fxri/swagger2api": patch
---

- 修复：文档缺少 `paths` 时静默以退出码 0 结束，现以可读错误终止并输出稳定错误码
- 修复：`components` 缺失或为 `null`、路径项与组件为 `null` 时抛 TypeError，现按归一或跳过处理并告警
- 修复：没有 `components.schemas` 时误报「缺少契约出口」，现补写空出口并正常生成
- 修改：Swagger 2.0 与空 `paths` 给出明确结论（`E_SPEC_INVALID` / `E_NO_ENDPOINTS`）
- 文档：补充仅支持 OpenAPI 3 与无契约产物的口径
