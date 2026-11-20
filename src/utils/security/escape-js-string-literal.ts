/**
 * 转义插入 JS/TS 双引号字符串字面量的值（不含两侧引号）。
 * 移植自 swagger-typescript-api 13.12.2 同名工具（MIT），保持与官方修复一致的输出。
 * @param value 原始值
 * @return 可安全放入双引号内的字符串
 */
export function escapeJsStringLiteral(value: string) {
  return JSON.stringify(value).slice(1, -1)
}
