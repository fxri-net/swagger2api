# 排障手册

> 由 `../SKILL.md` 按需加载。命令一律只读优先；带 `--yes` 的命令必须先经用户确认，AI 不自行追加。

## 症状 → 命令

| 症状 | 先跑 | 预期输出 | 下一步 |
| --- | --- | --- | --- |
| 不确定产物是否最新 | `swagger2api --check --json` | `ok: true`，或 `missing` / `mismatched` / `extra` 清单 | 有差异按下一行处理 |
| 产物缺失或内容不一致 | `swagger2api --check --json` | `errorCode: "E_CHECK_FAILED"` 与对应清单 | 重新生成后复检，不手补生成物 |
| 产物多余 / 组改名后残留 | `swagger2api --check --json`，再 `swagger2api prune --dir "<目录>" --json` | `extra` 列出带横幅文件；prune 返回 `dryRun: true` | 用户确认后加 `--yes` 删除 |
| 整个目录已废弃（删了文档 / 搬家） | `swagger2api prune --dir "<目录>" --json` | `files` 清单与数量 | 用户确认后 `--yes`；不要用 `--clean-output` |
| 多文档非交互报 `E_DOC_SELECTION_REQUIRED` | `swagger2api --target <id[,id]>` 或 `--all` | 生成 / 校验结果 | 脚本里显式给出选择，不依赖交互 |
| 文档输出目录重叠 | 生成时 stderr 与 `--json` 结论 | 文档 id 与重叠目录 | 拆分 `docs[].output`；冲突时退出码 2、不落盘 |
| 单文件模式出现分组残留 | 直接生成，读取 stderr 告警 | 「检测到输出目录含分组模式产物」 | 按告警执行 `prune --dir`，或 `output.clean` 重建 |
| 布局异常（模块过小 / 超上限） | `swagger2api inspect --dir "<目录>" --json` | `issues` 清单，`errorCode: "E_LAYOUT_ISSUES"` | 先 `--dry-run --json` 预览分桶与分片，再重新生成 |
| 配置读不到或被环境变量覆盖 | `swagger2api config status --json` | `layers` / `envOverrides` / `effective` | 按 `warnings` 修正，或显式传 `--config` |
| 配置目录不安全导致清理被拒 | 生成时的 stderr | `E_UNSAFE_DIR` 或「拒绝按横幅清理」 | 把输出目录改成具体产物目录，不在仓库根生成 |
| 文档生成前被拒绝（缺 `paths` / 空文档 / Swagger 2.0） | 生成时的 stderr，或 `--json` | `E_SPEC_INVALID` / `E_NO_ENDPOINTS` 与可读原因 | 修正文档结构；Swagger 2.0 先转 OpenAPI 3 |

## JSON 字段

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 结构版本，当前 `1`；更高版本时降级到 `--help` 与静态文档 |
| `toolVersion` | 工具版本，排查与复现时记录 |
| `command` | `check` / `inspect` / `prune` / `generate` |
| `ok` | 是否通过 |
| `errorCode` | 稳定错误码，成功为 `null` |
| `missing` / `mismatched` / `extra` | `check` 的三类清单 |
| `files` | `prune` 的生成物清单 |
| `message` | 失败说明 |
| `actions` | 建议的下一步命令，可直接复制 |

错误码：`E_CHECK_FAILED`、`E_LAYOUT_ISSUES`、`E_DIR_NOT_FOUND`、`E_UNSAFE_DIR`、`E_ARGS_MISSING`、`E_DOC_SELECTION_REQUIRED`、`E_SPEC_INVALID`、`E_NO_ENDPOINTS`。

## 典型失败输出

```json
{
  "schemaVersion": 1,
  "toolVersion": "1.3.3",
  "command": "check",
  "ok": false,
  "errorCode": "E_CHECK_FAILED",
  "missing": ["App.ts"],
  "mismatched": [],
  "extra": ["Old.ts"],
  "actions": ["swagger2api # 重新生成后再校验", "swagger2api prune --dir \"<目录>\" # 预览多余产物"]
}
```

- JSON 模式下 stdout 只有一份 JSON，人类日志在 stderr；输出 UTF-8 无 BOM，可直接 `JSON.parse`
- 退出码：`0` 通过；`1` 生成或校验失败；`2` 参数或配置错误

## 不可做

- 不在用户确认前追加 `--yes`，不把预览命令的 `files` 直接当作已删除
- 不手改生成物，不手写生成横幅（会被当成产物覆盖或清理）
- 不为了消除差异而关闭 `--check` 或跳过复检
