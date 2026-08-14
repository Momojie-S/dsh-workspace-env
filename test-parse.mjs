/**
 * parseDotEnv 单元测试 —— 从编译后的 lib/index.js 导入。
 */
import { parseDotEnv } from './lib/index.js'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tmp = mkdtempSync(join(tmpdir(), 'envtest-'))
let pass = 0, fail = 0

function test(name, got, expected) {
  const g = JSON.stringify(got)
  const e = JSON.stringify(expected)
  if (g === e) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}\n    expected: ${e}\n    got:      ${g}`) }
}

// Test 1: Standard KEY=VALUE
writeFileSync(join(tmp, '.env'), 'FOO=bar\nBAZ=qux\n')
test('standard KEY=VALUE', parseDotEnv(join(tmp, '.env')), { FOO: 'bar', BAZ: 'qux' })

// Test 2: Quoted values
writeFileSync(join(tmp, '.env'), 'MSG="hello world"\nMSG2=\'single quoted\'\n')
test('quoted values', parseDotEnv(join(tmp, '.env')), { MSG: 'hello world', MSG2: 'single quoted' })

// Test 3: Comments and empty lines
writeFileSync(join(tmp, '.env'), '# comment\n\nKEY=val\n  # indented comment\n')
test('comments + empty lines', parseDotEnv(join(tmp, '.env')), { KEY: 'val' })

// Test 4: Non-existent file
test('missing file → {}', parseDotEnv(join(tmp, 'nonexistent.env')), {})

// Test 5: DSH_ prefix filtered
writeFileSync(join(tmp, '.env'), 'DSH_SECRET=hack\nNORMAL=ok\nDSH_WEB_URL=evil\n')
test('DSH_ prefix filtered', parseDotEnv(join(tmp, '.env')), { NORMAL: 'ok' })

// Test 6: No = sign
writeFileSync(join(tmp, '.env'), 'JUSTKEY\nA=b\nnoequals\n')
test('no = sign skipped', parseDotEnv(join(tmp, '.env')), { A: 'b' })

// Test 7: Empty file
writeFileSync(join(tmp, '.env'), '')
test('empty file → {}', parseDotEnv(join(tmp, '.env')), {})

// Test 8: Value with = sign inside
writeFileSync(join(tmp, '.env'), 'URL=http://example.com?a=1&b=2\n')
test('value with = inside', parseDotEnv(join(tmp, '.env')), { URL: 'http://example.com?a=1&b=2' })

// Test 9: Windows CRLF
writeFileSync(join(tmp, '.env'), 'A=1\r\nB=2\r\n')
test('CRLF line endings', parseDotEnv(join(tmp, '.env')), { A: '1', B: '2' })

rmSync(tmp, { recursive: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
