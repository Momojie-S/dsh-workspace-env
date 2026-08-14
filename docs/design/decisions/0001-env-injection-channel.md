# ADR-0001：env 注入通道选型——包装 spawnSpec

状态：accepted（2026-08）

## 背景

需求：把 workspace `.env` 里的**任意变量**（`GH_TOKEN`、`WS_ENV_TEST`…）注入每次 pwsh 子进程。调研了 DSH 全部三条 env 通道（源码：`packages/shell/shell-env`、`packages/shell/tool-pwsh`）。

## 备选

| 通道 | 结论 |
|------|------|
| `ctx.shellEnv.register(contributor)`（官方 shell-env 插件） | ❌ 强制 `DSH_` 前缀（`register()` 校验直接抛错），`GH_TOKEN` 这类 key 注册不进去 |
| `ShellExecRequest.env` 字段 | ❌ 只有直接调 `ctx.shell.run()` 的代码能传（如 hooks bridges 注 `CLAUDE_PROJECT_DIR`）；tool-pwsh 构建请求时不给插件留口子 |
| 运行时包装 `shell.spawnSpec` | ✅ 能改最终 spawn env，任意 key 可注入 |

## 决策

包装 `spawnSpec`：`inject: ['shell']` 拿到服务实例，bind 保存原始方法，包装后合并 `parseDotEnv(<workdir>/.env)` 到 `result.env`，`ctx.effect` 恢复。

## 后果

- 可行且 workspace env 优先级最高；但 `spawnSpec` 是 **private 非契约方法**——DSH 升级改签名需跟进
- 包装绑在服务实例上，HMR 重建实例后旧包装静默失效（"改代码必须重启 DSH"的根因之一）
- 迁移条件：DSH 放开 `shellEnv` 前缀限制、或给 tool 请求留 env 注入口时，应优先迁移官方通道
