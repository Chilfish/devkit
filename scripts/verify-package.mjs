/**
 * Validate the published artifact:
 * - required dist files exist
 * - every `exports` target exists
 * - the packed tarball excludes source, tests and config
 *
 * Run `bun run build` first.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []

function fail(message) {
  failures.push(message)
}

function collectTargets(value, targets = []) {
  if (typeof value === 'string') {
    targets.push(value)
  }
  else if (value && typeof value === 'object') {
    for (const nested of Object.values(value))
      collectTargets(nested, targets)
  }
  return targets
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))

for (const target of collectTargets(pkg.exports)) {
  if (!target.startsWith('./'))
    continue
  if (!existsSync(new URL(`..${target.slice(1)}`, import.meta.url)))
    fail(`exports target does not exist: ${target}`)
}

for (const file of [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/shared/index.js',
  'dist/shared/index.cjs',
  'dist/cli/index.js',
  'dist/cli/index.cjs',
  'dist/env/index.js',
  'dist/env/index.cjs',
  'dist/local/index.js',
  'dist/local/index.cjs',
  'dist/proxy/index.js',
  'dist/proxy/index.cjs',
  'dist/storage/index.js',
  'dist/storage/index.cjs',
  'dist/commands/index.js',
  'dist/commands/index.cjs',
  'dist/bin/proxy.js',
]) {
  if (!existsSync(new URL(`../${file}`, import.meta.url)))
    fail(`missing build artifact: ${file}`)
}

let packInfo
try {
  const packArgs = [
    'pack',
    '--dry-run',
    '--json',
    '--ignore-scripts',
  ]
  // On Windows npm is a .cmd file, which execFile cannot run directly.
  const output = process.platform === 'win32'
    ? execFileSync('cmd.exe', [
        '/d',
        '/s',
        '/c',
        `npm ${packArgs.join(' ')}`,
      ], {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : execFileSync('npm', packArgs, {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
  packInfo = JSON.parse(output)[0]
}
catch (error) {
  fail(`npm pack --dry-run failed: ${error.message}`)
}

if (packInfo) {
  const files = new Set(packInfo.files.map(file => file.path))
  const required = [
    'package.json',
    'README.md',
    'LICENSE.md',
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/index.d.cts',
    'dist/bin/proxy.js',
  ]

  for (const file of required) {
    if (!files.has(file))
      fail(`tarball is missing a required file: ${file}`)
  }

  for (const file of files) {
    if (file.startsWith('src/') || file.startsWith('tests/') || file.startsWith('scripts/') || file.startsWith('docs/') || file.startsWith('examples/'))
      fail(`tarball must not include: ${file}`)
  }
}

if (failures.length > 0) {
  console.error('verify-package failed:')
  for (const message of failures)
    console.error(`  - ${message}`)
  process.exit(1)
}

console.log(`verify-package passed (${packInfo?.files.length ?? 0} files)`)
