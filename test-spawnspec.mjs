/**
 * spawnSpec 包装行为测试。
 *
 * 真实 shell 服务需要完整 Cordis ctx 才能实例化，
 * 这里用 mock parent + 从 lib/index.js 导入的 parseDotEnv/expandDotEnv 验证包装逻辑。
 */
import { parseDotEnv, expandDotEnv } from './lib/index.js'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tmp = mkdtempSync(join(tmpdir(), 'spawnspec-test-'))
let pass = 0, fail = 0

function test(name, got, expected) {
  const g = JSON.stringify(got)
  const e = JSON.stringify(expected)
  if (g === e) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n    expected: ${e}\n    got:      ${g}`) }
}

// Mock parent spawnSpec: returns env with the standard layering
function mockParentSpawnSpec(spec) {
  return {
    argv: ['pwsh.exe', '-Command', spec.command],
    cwd: spec.workdir,
    env: {
      NO_COLOR: '1',           // ENV_OVERRIDES
      EXISTING: 'parent',       // from spec.env or spec.dshEnv
      DSH_SESSION_ID: 'abc',    // DSH_* management var
      PATH: 'C:\\Windows;C:\\bin',
    }
  }
}

// Our override logic (mirrors workspace-env spawnSpec wrap body)
function ourSpawnSpec(spec) {
  const result = mockParentSpawnSpec(spec)
  const workspaceEnv = parseDotEnv(join(spec.workdir, '.env'))
  if (Object.keys(workspaceEnv).length > 0) {
    const expanded = expandDotEnv(workspaceEnv, result.env)
    result.env = { ...result.env, ...expanded }
  }
  return result
}

// Test 1: .env exists with vars → merged, highest priority
writeFileSync(join(tmp, '.env'), 'MY_API_KEY=secret123\nJAVA_HOME=/usr/lib/jvm\n')
const r1 = ourSpawnSpec({ workdir: tmp, command: 'echo hi' })
test('.env vars merged', r1.env, {
  NO_COLOR: '1', EXISTING: 'parent', DSH_SESSION_ID: 'abc', PATH: 'C:\\Windows;C:\\bin',
  MY_API_KEY: 'secret123', JAVA_HOME: '/usr/lib/jvm'
})

// Test 2: .env overrides existing env (workspace priority highest)
writeFileSync(join(tmp, '.env'), 'EXISTING=overridden\n')
const r2 = ourSpawnSpec({ workdir: tmp, command: 'echo hi' })
test('.env overrides parent env', r2.env, {
  NO_COLOR: '1', EXISTING: 'overridden', DSH_SESSION_ID: 'abc', PATH: 'C:\\Windows;C:\\bin'
})

// Test 3: .env with DSH_* → filtered, DSH management vars preserved
writeFileSync(join(tmp, '.env'), 'DSH_SESSION_ID=hack\nDSH_EVIL=bad\nSAFE=ok\n')
const r3 = ourSpawnSpec({ workdir: tmp, command: 'echo hi' })
test('DSH_* filtered, DSH vars preserved', r3.env, {
  NO_COLOR: '1', EXISTING: 'parent', DSH_SESSION_ID: 'abc', PATH: 'C:\\Windows;C:\\bin', SAFE: 'ok'
})

// Test 4: No .env → env unchanged
const tmp2 = mkdtempSync(join(tmpdir(), 'noenv-'))
const r4 = ourSpawnSpec({ workdir: tmp2, command: 'echo hi' })
test('no .env → unchanged', r4.env, {
  NO_COLOR: '1', EXISTING: 'parent', DSH_SESSION_ID: 'abc', PATH: 'C:\\Windows;C:\\bin'
})
rmSync(tmp2, { recursive: true })

// Test 5: Empty .env → env unchanged
writeFileSync(join(tmp, '.env'), '')
const r5 = ourSpawnSpec({ workdir: tmp, command: 'echo hi' })
test('empty .env → unchanged', r5.env, {
  NO_COLOR: '1', EXISTING: 'parent', DSH_SESSION_ID: 'abc', PATH: 'C:\\Windows;C:\\bin'
})

// Test 6: cwd and argv preserved
writeFileSync(join(tmp, '.env'), 'X=y\n')
const r6 = ourSpawnSpec({ workdir: tmp, command: 'test' })
test('cwd preserved', r6.cwd, tmp)
test('argv preserved', r6.argv, ['pwsh.exe', '-Command', 'test'])

// Test 7: ${VAR} reference → PATH prepend (parent env value)
writeFileSync(join(tmp, '.env'), 'PATH=D:\\tools;${PATH}\n')
const r7 = ourSpawnSpec({ workdir: tmp, command: 'echo hi' })
test('PATH prepend via ${PATH}', r7.env.PATH, 'D:\\tools;C:\\Windows;C:\\bin')

// Test 8: reference to another parent var
writeFileSync(join(tmp, '.env'), 'APP_DATA=${NO_COLOR}-suffix\n')
const r8 = ourSpawnSpec({ workdir: tmp, command: 'echo hi' })
test('reference other parent var', r8.env.APP_DATA, '1-suffix')

// Test 9: intra-file reference (later line uses earlier, expanded)
writeFileSync(join(tmp, '.env'), 'BASE=/opt\nTOOLS=${BASE}/bin\n')
const r9 = ourSpawnSpec({ workdir: tmp, command: 'echo hi' })
test('intra-file reference', r9.env.TOOLS, '/opt/bin')

// Test 10: undefined reference → empty string
writeFileSync(join(tmp, '.env'), 'X=${NOPE}!\n')
const r10 = ourSpawnSpec({ workdir: tmp, command: 'echo hi' })
test('undefined ref → empty', r10.env.X, '!')

// Test 11: plain value without refs stays untouched (old behavior)
writeFileSync(join(tmp, '.env'), 'PLAIN=abc\nOTHER=${PLAIN}d\n')
const r11 = ourSpawnSpec({ workdir: tmp, command: 'echo hi' })
test('plain value untouched', r11.env.PLAIN, 'abc')
test('ref to intra-file plain', r11.env.OTHER, 'abcd')

rmSync(tmp, { recursive: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
