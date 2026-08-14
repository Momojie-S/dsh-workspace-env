# ADR-0002：function 运行时包装，放弃 class 继承

状态：accepted（2026-08）

## 背景

最初方案：`class WorkspaceEnvPwshExecutor extends SandboxPwshExecutor`，override `spawnSpec()`，同时 patch 里 override `pwsh-sandbox` 行把 `name` 换成本插件。两条路都被现实挡住。

## 备选

| 方案 | 结论 |
|------|------|
| class 继承 override | ❌ `spawnSpec` 在官方 `.d.ts` 里是 **private**：TS2415/TS2855 拒绝子类 override；`@ts-expect-error` 压不住类声明错误。且 patch id override 不能改 `name`（`name mismatch, skipping` 拒绝） |
| function 插件运行时包装 | ✅ 纯运行时 monkey-patch 不看类型声明；独立 insert 行加载，不碰官方插件行 |

## 决策

function 形式（`export const name` + `apply(ctx)`），包装实例方法，独立 `insert` 行追加，`pwsh-sandbox` 原样保留。

## 后果

- 编译通过、部署简单、官方文件沙箱行为完整保留
- 依赖的 private 属性暴露面从"类型层"移到"运行时层"——风险同 ADR-0001，升级 DSH 后跑一次验证即可
- 教训沉淀：TS 拒绝往往是刻意的契约信号（源码确认 private 是有意设计），该转向就转向，不该硬绕
