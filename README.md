# dsh-workspace-env

> npm 包名：`@momojie-s/dsh-workspace-env`

DSH 插件：`pwsh` 工具每次调用时，自动把当前 workspace 目录下的 `.env` 注入子进程环境变量——workspace 级环境变量隔离，切项目自动切 env，agent 无感知。

## 环境要求

- DSH `0.1.0-rc.6`（已验证。依赖 shell 服务的 `spawnSpec` 内部方法，升级 DSH 后建议重跑验证）
- Windows pwsh（bash 链路未覆盖）

## 用法

workspace 根目录（session cwd）放一个 `.env`：

```bash
GH_TOKEN=gho_xxx
QUOTED="value with spaces"   # 成对单/双引号自动去除
PATH=D:\mytools;${PATH}      # ${VAR} 引用父环境，PATH 前置追加
# # 开头是注释；空行、无 = 的行跳过
```

- `.env` 每次命令调用现读，**改完立即生效，无需重启**
- `DSH_*` 前缀的 key 一律忽略（DSH 管理变量有自己的通道）
- **同 key 覆盖**：workspace `.env` 优先级最高，赢过系统环境变量、DSH 注入的一切同名变量（`DSH_*` 除外）
- **`${VAR}` 引用**：展开自父环境（系统变量 + DSH 注入）+ 同文件中更早定义的变量；未定义展开为空串。覆盖是整体替换，要追加就用引用：`PATH=D:\tools;${PATH}`

## 安装

本插件是**组合包**（`dsh.bundle`），用 `dsh plugin` 安装进 profile，自动追加配置层，无需手编 patch：

```bash
# GitHub（私仓需 git 凭据；pnpm ≥10 首次 add 会提示授权构建，按提示把包键
# 写进 ~/.dsh/profiles/web/pnpm-workspace.yaml 的 allowBuilds 后重新 add）
dsh plugin --profile web add github:Momojie-S/dsh-workspace-env

# 或 tarball（pnpm pack 产物，无授权要求）
dsh plugin --profile web add momojie-s-dsh-workspace-env-0.1.0.tgz
```

验证层就位后重启 DSH：

```bash
dsh web --dump-config | Select-String workspace-env   # 应看到 "# == dsh-workspace-env" 层
```

<details><summary>开发模式：源码直连（改代码 → 重启验证）</summary>

编译 `npm install && npm run build`，profile 的 `cordis.patch.yml` 手动加行（`name` 用 `file:///` URL 指向 `lib/index.js`）：

```yaml
- insert:
    - id: workspace-env
      name: file:///D:/code/workspace/deepseek-harness-101/plugins/dsh-workspace-env/lib/index.js
      disabled: !!js process.platform !== 'win32'
```

> 独立追加行，**不替换** `pwsh-sandbox`——文件沙箱能力完整保留（patch 也禁止 id override 改 `name`）。

</details>

## 配置

无。

## 验证

workspace 放 `.env` 写 `WS_ENV_TEST=hello`，让 agent 跑：

```
pwsh: echo $env:WS_ENV_TEST
```

输出 `hello` 即生效；切到无 `.env` 的目录同命令输出空，即隔离生效。

---

设计文档见 [docs/design/overview.md](docs/design/overview.md)；跨插件开发方法论见合集仓库 `docs/usage/dsh-plugin-development.md`。
