// vitest 配置：只收手写测试目录；先不设覆盖率阈值，避免为凑阈值写无效用例
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"]
  }
})
