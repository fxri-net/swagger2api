// 文档站分享卡片生成：按 toolkit 站点风格生成 docs/public/og-image.png（1024×512 紫底白标）。
// 幂等纯生成脚本，素材或文案变化后执行一次即可；仅开发期使用，不入 npm 包（files 白名单不含 scripts）
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const logo = readFileSync(join(root, "docs", "public", "logo.png"))

// 底色取自品牌图标紫（方弦图标-圆形.png 的主色），标题/副标题文案随站点定位
const svg = `<svg width="1024" height="512" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="512" fill="#A6A0DB"/>
  <g transform="translate(404, 56)">
    <image href="data:image/png;base64,${logo.toString("base64")}" width="216" height="216"/>
  </g>
  <text x="512" y="352" font-family="'Microsoft YaHei', 'PingFang SC', sans-serif" font-size="72" font-weight="bold" fill="#FFFFFF" text-anchor="middle">Swagger 转 API</text>
  <text x="512" y="428" font-family="'Microsoft YaHei', 'PingFang SC', sans-serif" font-size="34" fill="#FFFFFF" text-anchor="middle">基于 swagger-typescript-api 的接口代码生成工具</text>
</svg>`

writeFileSync(join(root, "scripts", "og-image-template.svg"), svg)
console.log("已生成 scripts/og-image-template.svg，请配合转换工具导出 og-image.png")
