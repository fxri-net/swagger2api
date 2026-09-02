# 任务管理规范（.tasks）

> 本项目的任务与归档区，规范与 `@fxri/toolkit` 的 `tasks` 域一致，文件结构、命名与 frontmatter 字段以包内 `SPEC.md` 为准（项目根无 `SPEC.md`）。

## 目录结构

```
.tasks/
├── README.md          # 本规范
├── active/            # 实时任务（未完成）
│   └── 202609/        # 年月（YYYYMM，直接拼）
│       └── 20260902-唐启云-接入toolkit工程化优化.md
└── archive/           # 任务归档（已完成）
    └── 202609/
        └── 20260902.md
```

## 命名规范

- active 任务文件：`年月日-用户名-任务简述.md`（一任务一文件）
- archive 归档文件：`年月日.md`（按完成时间划分）
- 年月日 / 年月均直接拼（`20260902` / `202609`），不加 `-`

## 任务文件模板

```markdown
---
owner: 唐启云            # 负责人（git 用户名）
status: 进行中          # 待办 / 进行中 / 已完成 / 阻塞 / 已放弃
created: 20260902
updated: 20260902
completed: ''           # 完成时间（YYYY-MM-DD HH:mm），已完成/已放弃时必填
depends_on: []          # 依赖的任务文件
scope: swagger2api      # 影响范围
---

# 任务标题
```

## 归档

- `pnpm tasks` 输出任务总览
- `pnpm tasks:archive`（`toolkit tasks archive`）归档已完成任务（`status` 为「已完成 / 已放弃」且带 `completed`）
- 归档文件按完成时间日期划分，文件内任务按完成时间升序排序
