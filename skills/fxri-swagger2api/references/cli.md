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
swagger2api skill               # 输出包内技能入口绝对路径
swagger2api skill --print       # 输出技能入口全文
swagger2api skill --json        # 输出入口、references 目录与技能版本
```

## 生成相关开关

| 参数 | 作用 |
| --- | --- |
| `--modular` | 按组拆分为多文件并生成聚合入口 |
| `--dry-run` | 只输出报表，不写产物；分组模式给出命名、桶 / 分片规划与预计新增文件 |
| `--json` | 与 `--dry-run` 组合时输出结构化报表 |
| `--prune-output` | 按上一轮清单清理已消失模块，不触碰手写文件 |
| `--config <path>` | 显式指定项目层配置 |
| `--target <id>` | 多目标配置下只执行指定目标；未知目标退出码 2 |
| `--profile <name>` | 选用配置内的命名预设 |

## 使用顺序

1. 改配置后先 `--dry-run --json`，重点看命名映射、桶与分片规划、预计新增文件。
2. 确认后生成；产物结构有变化时先清理旧产物或确认清单已覆盖。
3. 最后用 `--check` 验收，不要在 `--check` 模式下期待写盘。

完整参数与边界见仓库 `docs/cli.md`。
