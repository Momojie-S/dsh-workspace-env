# dsh-workspace-env

DSH (DeepSeek Harness) 插件：`pwsh` 工具每次调用时，自动从当前 session 的 **workspace 目录**读取 `.env`，注入到子进程环境变量——实现 workspace 级环境变量隔离。切 workspace 自动切 env，agent 无感知。

## 解决什么问题

- 多个项目需要不同的 API key / token（如多 GitHub 账户的 `GH_TOKEN`），不想互相串
- `~/.dsh/.env` 是全局的，且启动后冻结，不适合项目级配置
- agent 跑命令时自动带上项目变量，不用每次手动 `$env:XXX = "..."`

## 用法

在 workspace 根目录（session cwd）放一个 `.env`：

```bash
# 注释行
GH_TOKEN=gho_xxx
QUOTED="value with spaces"
SINGLE='single quoted'
```

验证（workspace 有 `.env` 时输出对应值，没有则输出空）：

```
pwsh: echo $env:GH_TOKEN
```

**`.env` 每次命令调用时现读，改完立即生效**（只有改本插件代码才需要重启 DSH）。

### .env 格式规则

- 文件不存在 → 正常，不注入任何变量
- 空行 / `#` 注释 / 无 `=` 的行 → 跳过
- 值带成对的单引号或双引号 → 去引号
- `DSH_*` 前缀的 key → **一律过滤**。DSH 管理变量有自己的通道，且 executor 会丢弃 ambient `DSH_*`，写了也无效

### env 优先级（低 → 高）

```
ENV_OVERRIDES (NO_COLOR 等)
  < spec.env (hooks bridges 注入)
  < spec.dshEnv (DSH_* 管理变量，另一条通道)
  < workspace .env (本插件注入，优先级最高)
```

项目专属配置覆盖一切（`DSH_*` 除外，见上）。

## 工作原理

TypeScript function 插件（`export const name = 'workspace-env'` + `inject: ['shell']`），激活时**运行时包装** `ctx.shell.spawnSpec`：

```
pwsh 工具调用
  ↓
tool-pwsh 从 session cwd 拿 workdir（天然跟随 workspace）
  ↓
ctx.shell.spawnSpec(spec)              ← 本插件包装点
  1. 调原始 spawnSpec：组装完整 spawn 参数
     （pwsh-local 的进程/env 组装 + pwsh-sandbox 的文件沙箱）
  2. 读 <workdir>/.env → parseDotEnv()
  3. 合并到 result.env（覆盖同名键）
  ↓
ctx.subprocess.spawn() → pwsh 子进程
```

要点：

- **不替换任何官方插件行**：`pwsh-sandbox` 原样保留，文件沙箱能力完整
- **副作用可逆**：原始方法以 bound 引用保存，`ctx.effect` 保证插件卸载时恢复
- 每次调用都重读 `.env`，无缓存

### 为什么包装 spawnSpec（设计取舍）

| 通道 | 能否注入任意变量 | 说明 |
|------|----------------|------|
| `ctx.shellEnv.register()`（官方 `dsh-shell-env` 插件） | ❌ | 强制 `DSH_` 前缀，其它 key 注册时直接抛错 |
| `ShellExecRequest.env` 字段 | ❌ | 只有直接调 `ctx.shell.run()` 的代码能传，tool-pwsh 不给插件留口子 |
| 包装 `shell.spawnSpec`（本插件） | ✅ | 见下述代价 |

`spawnSpec` 是 private 非契约方法，包装属于逃生舱：若 DSH 未来放开 `shellEnv` 前缀限制或给 tool 请求留 env 注入口，应优先迁移。

## 安装

### 1. 编译

```bash
cd plugins/dsh-workspace-env
npm install        # typescript + @types/node；peer 依赖 @deepseek-ai/* 由 DSH 运行时提供，装不上只是 warning
npm run build      # tsc: src/index.ts → lib/
```

本插件运行时零 `@deepseek-ai` import（仅 `node:fs` / `node:path`），无需手动 junction 依赖（旧版本方案的遗留，现已不需要）。

### 2. 加入 profile patch

在 `~/.dsh/profiles/web/cordis.patch.yml` 追加独立 insert 行（**不要**试图 override `pwsh-sandbox` 行——patch 禁止 id override 改 `name`，会报 `name mismatch, skipping`）：

```yaml
- insert:
    - id: workspace-env
      name: file:///D:/code/workspace/deepseek-harness-101/plugins/dsh-workspace-env/lib/index.js
      disabled: !!js process.platform !== 'win32'   # 仅 Windows 启用
```

按你机器的实际路径改 `name`。

### 3. 重启 DSH

patch 新增行可 HMR 热生效，但首次部署建议重启确认。之后日常只改 `.env` 不用重启。

## 测试

### 单元测试

```bash
cd plugins/dsh-workspace-env
node test-parse.mjs        # parseDotEnv 解析逻辑 (9 tests)
node test-spawnspec.mjs    # spawnSpec 包装合并行为 (7 tests)
```

### 集成验证

1. workspace 根目录放 `.env`：`WS_ENV_TEST=hello-from-workspace-env`
2. 重启 DSH，会话中运行 `pwsh: echo $env:WS_ENV_TEST` → 输出 `hello-from-workspace-env`
3. 切到无 `.env` 的 workspace → 同命令输出空 → 隔离生效

## 已知限制

- **仅 pwsh（Windows）**：bash executor 是另一条链路，未覆盖
- **改插件代码必须重启 DSH**：Node ESM 缓存导致 patch `?v=N` 绕缓存不可靠——HMR 循环后 shell 服务实例可能重建，包装握着旧实例静默失效
- **`DSH_*` 永远注不进**：被本插件过滤 + 被 executor 丢弃，双重保险（设计如此）
- `spawnSpec` 是 private 非契约方法，DSH 升级若改其签名，本插件需跟进
