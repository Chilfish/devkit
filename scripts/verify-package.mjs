/**
 * Validate the published artifact:
 * - every `exports` target exists (the manifest is the only entry list)
 * - the packed tarball contains the required files and excludes source,
 *   tests, scripts and docs
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

const targets = collectTargets(pkg.exports)
  .filter(target => target.startsWith('./'))
for (const target of targets) {
  if (!existsSync(new URL(`..${target.slice(1)}`, import.meta.url)))
    fail(`exports target does not exist: ${target}`)
}

for (const field of ['main', 'module', 'types']) {
  const target = pkg[field]
  if (typeof target === 'string' && target.startsWith('./')
    && !existsSync(new URL(`..${target.slice(1)}`, import.meta.url))) {
    fail(`${field} does not exist: ${target}`)
  }
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
  const parsed = JSON.parse(output)
  // npm <= 11 returns an array; npm >= 12 returns a map keyed by package name.
  packInfo = Array.isArray(parsed)
    ? parsed[0]
    : (parsed[pkg.name] ?? Object.values(parsed)[0])
}
catch (error) {
  fail(`npm pack --dry-run failed: ${error.message}`)
}

if (!packInfo) {
  fail('npm pack --dry-run returned no package metadata')
}
else {
  const files = new Set((packInfo.files ?? []).map(file => file.path))
  if (files.size === 0)
    fail('npm pack --dry-run returned an empty file list')

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

console.log(`verify-package passed (${packInfo?.files?.length ?? 0} files)`)
