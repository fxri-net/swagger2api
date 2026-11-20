import parser from "@typescript-eslint/parser"
import plugin from "@typescript-eslint/eslint-plugin"
import prettier from "eslint-config-prettier/flat"

/** 全局变量：沿用旧 eslintrc 的 browser/node/es2021 与本仓自定义项 */
const globals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  ga: "readonly",
  cordova: "readonly",
  __statics: "readonly",
  __QUASAR_SSR__: "readonly",
  __QUASAR_SSR_SERVER__: "readonly",
  __QUASAR_SSR_CLIENT__: "readonly",
  Capacitor: "readonly",
  chrome: "readonly",
  withDefaults: true,
  defineOptions: true,
  defineProps: true,
  defineEmits: true,
  defineExpose: true,
  wx: true
}

export default [
  {
    files: ["src/**/*.ts", "scripts/**/*.mjs"],
    languageOptions: {
      parser,
      ecmaVersion: 2021,
      sourceType: "module",
      globals
    },
    plugins: { "@typescript-eslint": plugin },
    rules: {
      ...plugin.configs.recommended.rules,
      "prefer-promise-reject-errors": "off",
      // 允许无插值的模板字符串作字符串字面量：生成代码片段与样例含双引号，改写会引入转义噪音
      quotes: ["warn", "double", { avoidEscape: true, allowTemplateLiterals: true }],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // 关闭未使用表达式校验（允许短路表达式如 a && doSomething()）
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
      // allow debugger during development only
      "no-debugger": process.env.NODE_ENV === "production" ? "error" : "off",
      "@typescript-eslint/no-this-alias": "off",
      // 关闭骆驼式变量名校验
      camelcase: "off"
    }
  },
  prettier
]
