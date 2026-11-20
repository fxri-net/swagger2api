import { defineConfig } from "tsup"
import { copy } from "esbuild-plugin-copy"

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"], // 入口文件
  outDir: "dist", // 输出目录
  splitting: false, // 是否开启代码分割
  esbuildPlugins: [copy({ assets: [{ from: "./src/templates/**/*", to: "./templates" }] })], // 带上模板文件
  clean: true, // 是否清理dist目录
  dts: true, // 是否生成.d.ts类型文件
  format: ["cjs", "esm"], // 输出CommonJS和ESM双格式
  minify: process.env.NODE_ENV === "production",
  target: "node18", // Node.js版本目标
  // 双格式构建的预期提示：CJS 产物没有 import.meta，运行时由 __filename 分支兜底，无需告警
  esbuildOptions(options) {
    options.logOverride = { ...options.logOverride, "empty-import-meta": "silent" }
  }
})
