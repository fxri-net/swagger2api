# 旧用法迁移

> 由 `../SKILL.md` 按需加载。迁移只在首次接入或结构调整时做一次。

## 一键迁移（推荐）

```bash
swagger2api upgrade --dry-run   # 只输出计划
swagger2api upgrade --diff      # 计划 + 行级差异
swagger2api upgrade --check     # 只读复检旧资产
swagger2api upgrade --yes       # 执行并备份
swagger2api upgrade --restore latest # 回退
```

- 发现 `saconfig*`、`.swagger2apirc*`、旧版 `defaults` + `targets` 与根级扁平字段，按配置目录独立迁移为 `base` + `docs`。
- 生成脚本只按命令值识别：直连 `swagger2api` 调用（可带 `npx` / `pnpm exec` / 可执行文件路径前缀）的个性化参数收敛进配置，脚本名、数量与命令前缀原样保留；单文档改写为 `swagger2api`，多文档改写为 `swagger2api --target <id>`。
- 带 `--check` 的脚本、`grouping` / `inspect` / `prune` / `surface` / `config` / `skill` / `init` 等子命令、`--version` / `--help`，以及复合命令（`&&`、`||`、`;`、管道、后台 `&`）、含环境变量赋值或位置参数的脚本一律不动。
- 脚本目标文档按序唯一确定：`--config <旧配置>` → `--target <id>` → `--url` / `--output` / `--name` 唯一匹配 → 单文档兜底；仍无法唯一确定时保留原脚本并列为人工项。
- 不要向用户承诺「迁移会把脚本收成一个 `api`」：迁移不新增、不删除、不重命名脚本；旧版本删掉的脚本也不会自动恢复，需要时从版本库或备份补回。
- `upgrade --check` 只报「旧配置文件仍存在」与「直连脚本仍带配置类参数」；`api:*` 引用、聚合脚本与检查脚本不算遗留。
- `defaults` → `base`、`targets` → `docs`、`input` → `source`，`client` / `language` 对象收敛为字符串。
- 未知脚本参数不猜：该项停止自动迁移并以退出码 1 结束；修正后重跑。
- 写入前备份到 `.swagger2api/backup/<时间>/`，`--restore latest` 可回退；`--keep-legacy` 保留旧配置。
- `init --from-script package.json` 等价于以该目录为范围的 `upgrade --yes`，仅作兼容别名。

## 手工迁移

- 新项目直接用 `base` + `docs`；旧项目的绝对路径、令牌不要带过来，相对路径按新配置目录重定。
- 多个旧配置各写一个文档项，`id` 唯一；同一配置内输出目录不得相同或嵌套。
- 迁移后每个应用目录只保留一份 `swagger2api.json`；脚本数量与名称保持不变，多文档用 `--target` 区分。

## 跨版本迁移比对

迁移工具版本或产物结构前，先固定接口面基线：

```bash
swagger2api surface --out .swagger2api/surface.json
# 迁移后
swagger2api surface --compare .swagger2api/surface.json
```

- 从产物目录的 `.ts` / `.d.ts` / `.js` 提取 `@request`、`@name` 与导出类型，结果带 `formatVersion`，默认不提交
- 比对一致退出 0；有增删逐条输出 `+` / `-` 并非 0 退出；`--requests-only` 只锁接口集合，忽略方法名与类型名
- 多文档配置按文档 `id` 分组比对，目标新增 / 缺失同样报错；`--target <id[,id]>` 只处理指定文档
- 基线建议放 `.swagger2api/` 并加入忽略清单；需要长期回归时由 CI 生成后临时比对

## 迁移后的验收

1. `upgrade --dry-run --json` 确认计划；`--diff` 检查 `package.json` 与配置差异。
2. `--yes` 后跑一次生成（多文档显式 `--all` 或 `--target`），确认产物结构与旧产物差异符合预期。
3. `upgrade --check` 为 0 且 `--check` 通过后，才删除备份目录；不要把两套配置同时留在仓库。
4. 更新项目脚本与文档中的命令；后续日常生成不再需要加载本技能。
