---
"@fxri/swagger2api": patch
---

- 修复：TS 分组产物的模块文件与 route-types 只对运行时枚举按值导入，纯类型统一写 `import type`
- 修复：客户端底座的 `RequestParams` 作为类型导入，避免 `verbatimModuleSyntax` 项目中开发服务启动即报缺失导出
- 修改：JS 产物的声明文件不参与运行期，保持值导入形态
