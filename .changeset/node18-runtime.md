---
"@fxri/swagger2api": minor
---

- 修改：运行时下限放宽至 node 18.12.0，构建目标同步改为 node18，CI 新增 node18 运行时回归 job
- 修改：`swagger-typescript-api` 降到 13.0.28，13.1 起改用 biome WASM 格式化，在 node 18 上生成即失败
- 清理：移除 `glob` 依赖，配置文件扫描改为内部递归遍历，保持原有匹配范围、忽略规则与排序
- 优化：`tsconfig` 开启 `skipLibCheck`，适配降级后依赖自带的声明文件
- 优化：`lodash` 通过 overrides 升到 4.18.1，修复其代码注入与原型污染告警
- 文档：说明 node18 线生成器版本的已知安全告警（代码注入 / SSRF）及其适用边界
