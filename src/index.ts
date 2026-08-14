/**
 * dsh-workspace-env
 *
 * 让 pwsh 工具在每次调用时，自动从当前 workspace 目录读取 .env 文件，
 * 注入到子进程环境变量。实现 workspace 级环境变量隔离——
 * 切 workspace 自动切换 env，无需重启、无需改 agent 调用方式。
 *
 * 实现方式: 作为独立插件行追加（不替换 pwsh-sandbox），在 apply() 中
 * 包装 ctx.shell.spawnSpec，在读到父类组装好的 spawn 参数后，
 * 从 spec.workdir/.env 读取 workspace 级环境变量合并到 result.env。
 *
 * env 优先级（最终）:
 *   ENV_OVERRIDES (NO_COLOR 等)
 *     < spec.env (hooks bridges)
 *     < spec.dshEnv (DSH_* 管理变量)
 *     < workspace .env (本插件注入，优先级最高)
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 解析 .env 文件为 key-value 对象。
 *
 * 规则:
 *  - 文件不存在 → 返回 {}（正常状态，无 workspace env）
 *  - 空行 / # 注释行 → 跳过
 *  - 无 = 的行 → 跳过
 *  - 带引号的值 → 去引号（单引号 / 双引号）
 *  - DSH_* 前缀的 key → 过滤掉（防止误覆盖 DSH 管理变量）
 */
export function parseDotEnv(filePath: string): Record<string, string> {
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return {}
  }

  const env: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    if (key.startsWith('DSH_')) continue

    if (key) env[key] = value
  }
  return env
}

/**
 * 展开 .env 值中的 ${VAR} 引用（dotenv-expand 风格）。
 *
 * lookup 来源（优先级从高到低）:
 *  1. 同文件中更早定义、已展开的变量
 *  2. 父环境 parent（即将被覆盖的完整子进程 env：系统变量 + DSH 注入）
 *
 * 未定义的引用展开为空串。只支持 ${VAR} 形式（边界明确），
 * 不做 $VAR 简写与转义。典型用法: PATH 前置追加 `PATH=D:\tools;${PATH}`。
 */
export function expandDotEnv(
  env: Record<string, string>,
  parent: Record<string, string>,
): Record<string, string> {
  const lookup: Record<string, string> = { ...parent }
  const result: Record<string, string> = {}
  const ref = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
  for (const [key, value] of Object.entries(env)) {
    const expanded = value.replace(ref, (_m, name) =>
      Object.hasOwn(lookup, name) ? lookup[name] : '')
    result[key] = expanded
    lookup[key] = expanded
  }
  return result
}

export const name = 'workspace-env'
export const inject = ['shell']

export function apply(ctx: any) {
  const shell = ctx.shell

  const originalSpawnSpec = shell.spawnSpec.bind(shell)

  shell.spawnSpec = function (spec: { workdir: string }, ...rest: any[]) {
    const result = originalSpawnSpec(spec, ...rest)

    const workspaceEnv = parseDotEnv(join(spec.workdir, '.env'))

    if (Object.keys(workspaceEnv).length > 0) {
      const expanded = expandDotEnv(workspaceEnv, result.env)
      result.env = { ...result.env, ...expanded }
    }

    return result
  }

  ctx.effect(() => () => {
    shell.spawnSpec = originalSpawnSpec
  })
}
