# 常用配方

> 由 `../SKILL.md` 按需加载。命令均可在项目根直接执行；AI / CI 一律显式传 `--config`。

## 首次接入

```bash
# 1. 生成最小配置（交互式；AI 环境下手写文件并显式指定）
swagger2api init
# 2. 预览分组规划（大文档推荐）
swagger2api --dry-run --json
# 3. 生成并校验
swagger2api --config swagger2api.json
swagger2api --check --json
```

最小配置：

```json
{
  "base": { "output": { "mode": "grouped" } },
  "docs": [
    { "id": "main", "source": "https://example.com/v3/api-docs", "output": "./src/api" }
  ]
}
```

## 多文档

```json
{
  "base": { "output": { "mode": "grouped" } },
  "docs": [
    { "id": "base", "source": "https://example.com/base/v3/api-docs", "output": "./src/api/base" },
    { "id": "lc", "source": "https://example.com/lc/v3/api-docs", "output": "./src/api/lc" }
  ]
}
```

```bash
swagger2api --config swagger2api.json --all                # 全部文档
swagger2api --config swagger2api.json --target lc          # 单个文档
swagger2api --config swagger2api.json --target base,lc     # 多个文档
swagger2api --config swagger2api.json --all --check --json # 全部校验
```

输出目录相同或互相嵌套会被拒绝（退出码 2）；每个应用目录只维护一份配置。

## 离线迁移（文档不可用）

```bash
# 1. 从旧产物记录接口面
swagger2api surface --out .swagger2api/surface.json
# 2. 用本地快照生成
swagger2api --config swagger2api.json   # docs[].source 指向本地快照
# 3. 比对接口面，要求增删为 0
swagger2api surface --compare .swagger2api/surface.json
# 4. 校验产物
swagger2api --check --json
```

## CI 接入

```bash
swagger2api --version                                   # 日志记录实际版本
swagger2api --config swagger2api.json --all --no-interactive
swagger2api --config swagger2api.json --check --json     # ok=false 时失败
swagger2api inspect --dir ./src/api --json --strict      # 布局异常直接失败
```

- JSON 模式 stdout 只有一份 JSON，可直接交给注解 / 摘要步骤；退出码 0/1/2 分别对应通过、校验失败、配置错误。

## 混放目录清理

```bash
swagger2api prune --dir ./src/api/old --json   # 预览：只列带横幅的生成物
swagger2api prune --dir ./src/api/old --yes    # 用户确认后删除；手写文件保留
```

- 配置删掉某个文档、目录搬家或模式切换后使用；不要用 `output.clean` 清理含手写文件的目录。
- 当前输出目录内的失效产物不需要手动清理，生成时的 `output.prune` 会处理。
