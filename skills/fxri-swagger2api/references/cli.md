# CLI 参数

> 由 `../SKILL.md` 按需加载。可执行文件短名 `swagger2api`；npx / dlx 时用全名 `@fxri/swagger2api`。

## 常用命令

```bash
swagger2api                     # 按最近的 swagger2api.json 生成
swagger2api --target lc         # 多目标配置下只生成指定目标
swagger2api --check             # 生成到临时目录并与现有产物比对，不写真实目录
swagger2api init                # 交互生成 swagger2api.json
swagger2api init --from-script package.json # 从既有 npm script 迁移参数
swagger2api grouping            # 查看分组分布并写入分组配置
swagger2api config status       # 查看配置分层与生效结果
swagger2api surface --out .swagger2api/surface.json   # 写接口面基线
swagger2api surface --compare .swagger2api/surface.json # 与基线比对接口与类型增删
swagger2api inspect --dir ./src/api/base   # 只读审计产物布局（模块体量 / 固定产物 / 小文件）
swagger2api prune --dir ./src/api/old      # 清理废弃目录中的生成物（默认只列，--yes 才删）
swagger2api skill               # 输出包内技能入口绝对路径
swagger2api skill --print       # 输出技能入口全文
swagger2api skill --json        # 输出入口、references 目录与技能版本
```

## 生成相关开关

| 参数 | 作用 |
| --- | --- |
| `--modular` | 按组拆分为多文件并生成聚合入口 |
| `--dry-run` | 只输出报表，不写产物；分组模式给出命名、桶 / 分片规划与预计新增文件 |
| `--json` | 与 `--dry-run` 组合输出结构化报表；与 `--check` 组合输出结构化校验结果（`schemaVersion`、`toolVersion`、`missing` / `mismatched` / `extra`） |
| `--prune-output` | 按生成横幅清理本轮不再生成的产物，只读文件头前 1KB，不触碰手写文件；关闭时只报告不删除 |
| `--config <path>` | 显式指定项目层配置 |
| `--target <id>` | 多目标配置下只执行指定目标；未知目标退出码 2 |
| `--profile <name>` | 选用配置内的命名预设 |

## 使用顺序

1. 改配置后先 `--dry-run --json`，重点看命名映射、桶与分片规划、预计新增文件。
2. 确认后生成；产物结构有变化时先确认旧产物会按横幅清理（分组默认开启，单文件模式只告警）。
3. 最后用 `--check` 验收（可加 `--json`），不要在 `--check` 模式下期待写盘。
4. 离线产物或手改产物用 `swagger2api inspect --dir <目录>` 校验布局：小组并桶、分片余量与固定产物；`--strict` 可让异常直接失败。
5. 配置删掉 target 或目录搬家后，用 `swagger2api prune --dir <目录>` 收尾：默认只列带生成横幅的文件，确认后加 `--yes`；不要用 `--clean-output` 清理混放手写文件的目录。

完整参数与边界见仓库 `docs/cli.md`。
