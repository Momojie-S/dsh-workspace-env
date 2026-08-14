# 设计总览：dsh-workspace-env

## 目标

- `pwsh` 工具调用自动带上 workspace 级 `.env`，切 workspace 自动切换 env
- agent 零感知：不改调用方式、不需要重启（改 `.env` 即时生效）

## 非目标

- bash executor 覆盖（另一条链路，未涉及）
- 注入 `DSH_*` 管理变量（官方 `dsh-shell-env` 插件的职责，见下文）
- `.env` 多环境文件（`.env.production` 等）
- `$VAR` 简写与转义（只支持 `${VAR}`，见 [ADR-0004](decisions/0004-var-interpolation.md)）

## 工作原理

```
pwsh 工具调用
  ↓
tool-pwsh 从 session cwd 拿 workdir（天然跟随 workspace）
  ↓
ctx.shell.spawnSpec(spec)              ← 本插件包装点
  1. 调原始 spawnSpec：组装完整 spawn 参数
     （pwsh-local 的进程/env 组装 + pwsh-sandbox 的文件沙箱）
  2. 读 <workdir>/.env → parseDotEnv()
  3. 展开 ${VAR} 引用 → expandDotEnv()（lookup: 父环境 + 文件内先定义项）
  4. 合并到 result.env（覆盖同名键）
  ↓
ctx.subprocess.spawn() → pwsh 子进程
```

- TypeScript function 插件，`inject: ['shell']` 等服务就绪后激活
- 原始方法以 bound 引用保存，`ctx.effect` 保证插件卸载时恢复
- **不替换**官方 `pwsh-sandbox` 插件行，文件沙箱能力完整保留
- 值中的 `${VAR}` 引用（dotenv-expand 风格）在合并前展开，典型场景 `PATH=D:\tools;${PATH}` 前置追加（[ADR-0004](decisions/0004-var-interpolation.md)）

## env 分层（低 → 高）

```
ENV_OVERRIDES (NO_COLOR 等)
  < spec.env (hooks bridges 注入)
  < spec.dshEnv (DSH_* 管理变量，另一条通道)
  < workspace .env (本插件注入，优先级最高)
```

`DSH_*` 前缀的 key 在 `parseDotEnv` 中被过滤——即使漏进来，executor 也会丢弃 ambient `DSH_*` 再注入官方 registry snapshot，双保险。`.env` 永远无法覆盖 DSH 管理变量，这是刻意设计。

## 与官方 shell-env 插件的关系

`dsh-shell-env` 提供 `ctx.shellEnv` 注册表，管理受信任的 `DSH_*` facts（`DSH_HOME`/`DSH_SHELL`/`DSH_SESSION_ID`…）。它强制 `DSH_` 前缀，注册其它 key 直接抛错——因此无法承担"注入 `GH_TOKEN` 等任意变量"的需求，本插件包装 `spawnSpec` 是逃生舱。若 DSH 未来放开前缀限制或给 tool 请求留 env 注入口，应迁移（见 [ADR-0001](decisions/0001-env-injection-channel.md)）。

## 已知限制

- `spawnSpec` 是 private 非契约方法，DSH 升级若改签名需跟进并重跑验证
- 改本插件代码必须重启 DSH：HMR 循环后 shell 服务实例可能重建，包装握旧实例静默失效
- 仅 pwsh（Windows）
