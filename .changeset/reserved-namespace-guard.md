---
"@fxri/swagger2api": patch
---

- 修复：聚合成员保留名改为大小写不敏感，`setSecurityData` 等驼峰名字标签不再覆盖客户端底座成员
- 修复：单文件模式路径首段命中保留名时自动改名，避免 `request` / `setSecurityData` 命名空间覆盖 `HttpClient` 能力
- 修改：`grouping.names` 手工名命中聚合成员时直接报错，不再静默生成坏产物
