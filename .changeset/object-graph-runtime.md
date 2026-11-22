---
"@fxri/swagger2api": minor
---

- 修改：生成物对象图契约收敛为「可枚举自有属性只允许方法 / 叶子数据」，`--single-http-client` 的 `http` 改为不可枚举访问，与模块 / 门面一致
- 修改：`HttpClient` 的 `instance`、`securityData`、`securityWorker`、`secure`、`format` 改为不可枚举自有字段，深合并与序列化不再进入 Axios 图
- 修复：`procedure-call` 渲染不再回写共享路由的 `query.type`，同一路由多次渲染结果稳定
- 修复：`deepMergeConfig` 与迁移的 `mergeDeep` 用祖先栈检测循环引用，覆盖层成环时给可读错误而不是栈溢出
- 新增：运行期对象图回归覆盖单文件、分组、分片与 `--single-http-client`，断言可枚举图无环、`JSON.stringify` 可用、回指字段不可枚举、方法可调用
- 文档：补齐对象图契约、`--single-http-client` 口径与合并守卫说明
