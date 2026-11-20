/**
 * 转义插入 JS 模板字面量的静态部分（反斜杠、反引号、`${`）。
 * 移植自 swagger-typescript-api 13.12.2 同名工具（MIT）。
 * @param value 原始值
 * @return 可安全放入模板字面量体内的字符串
 */
export function escapeJsTemplateLiteralStatic(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
}

/**
 * 按已声明的路径参数保留 `${param}` 插值，其余部分按静态模板字面量转义。
 * @param path 路由路径
 * @param pathParamNames 已声明的路径参数名
 * @return 可安全放入模板字面量体的字符串
 */
export function escapeJsTemplateLiteralWithPathParams(path: string, pathParamNames: readonly string[]) {
  if (pathParamNames.length === 0) return escapeJsTemplateLiteralStatic(path)
  const paramPattern = new RegExp(pathParamNames.map((name) => `\\$\\{${escapeRegExp(name)}\\}`).join("|"), "g")
  let result = ""
  let lastIndex = 0
  for (const match of path.matchAll(paramPattern)) {
    if (match.index === undefined) continue
    result += escapeJsTemplateLiteralStatic(path.slice(lastIndex, match.index))
    result += match[0]
    lastIndex = match.index + match[0].length
  }
  result += escapeJsTemplateLiteralStatic(path.slice(lastIndex))
  return result
}

/**
 * 转义正则元字符。
 * @param str 原始字符串
 * @return 可安全放入正则的字符串
 */
function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
