# 旧用法迁移

> 由 `../SKILL.md` 按需加载。迁移只在首次接入或结构调整时做一次。

## 从 npm script 迁移

```bash
swagger2api init --from-script package.json
```

- 读取 `package.json` 里调用本工具的脚本，把可识别的参数转成配置。
- 未能识别的参数会在 stderr 列出，逐项确认后再手工补进 `swagger2api.json`。
- 有未识别参数时退出码非 0；补完后重跑一次直到干净。

## 从 saconfig.json 迁移

- 新项目优先用分层 `swagger2api.json`；旧的 `saconfig.json` 仍兼容，但不再承载分组与清理能力。
- 迁移时只搬实际生效的字段，不照抄整份旧配置。
- 路径、输出目录与名字按新项目重定；旧项目的绝对路径不要带过来。

## 跨版本迁移比对

迁移工具版本或产物结构前，先固定接口面基线：

```bash
swagger2api surface --out .swagger2api/surface.json
# 迁移后
swagger2api surface --compare .swagger2api/surface.json
```

- 从产物目录的 `.ts` / `.d.ts` / `.js` 提取 `@request`、`@name` 与导出类型，结果带 `formatVersion`，默认不提交
- 比对一致退出 0；有增删逐条输出 `+` / `-` 并非 0 退出；`--requests-only` 只锁接口集合，忽略方法名与类型名
- 多目标配置按 `id` 分组比对，目标新增 / 缺失同样报错；`--target <id>` 只处理单个目标
- 基线建议放 `.swagger2api/` 并加入忽略清单；需要长期回归时由 CI 生成后临时比对

## 迁移后的验收

1. `--dry-run --json` 对比迁移前后的命名与预计文件。
2. 生成一次，确认产物结构与旧产物差异符合预期。
3. `--check` 通过后删除旧配置文件与旧产物；不要把两套配置同时留在仓库。
4. 更新项目脚本与文档中的命令；后续日常生成不再需要加载本技能。
