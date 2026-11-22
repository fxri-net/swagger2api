---
"@fxri/swagger2api": minor
---

- 新增：`swagger2api upgrade` 一键迁移 `saconfig*`、`.swagger2apirc*`、旧版 `defaults` + `targets` 与生成脚本，输出 `base` + `docs`
- 新增：`--dry-run` / `--diff` / `--check` / `--yes` / `--only` / `--skip` / `--cwd` / `--json` / `--keep-legacy` / `--restore`
- 修改：生成脚本收编为单一 `api`，删除 `api:*` 与 `api:check`；仓库内聚合脚本的 `api:<id>` 引用改为内联 `--target`
- 修改：写入前备份到 `.swagger2api/backup/<时间>/`，`--restore latest` 可回退；`init --from-script` 转为 `upgrade --yes` 别名
