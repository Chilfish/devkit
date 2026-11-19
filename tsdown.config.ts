import { defineConfig } from 'tsdown'

/**
 * Three build targets:
 * - neutral: `.` and `./shared`, no node/bun builtins, safe for Workers and browsers;
 * - node: CLI, env, local, storage and commands, may use `node:*`;
 * - bun: `./proxy` and `./bin/proxy`, using `Bun.serve` and a shebang.
 *
 * `exports` is maintained by hand in package.json; the build never rewrites it.
 */
function outExtensions({ format }: { format: string }): { js: string, dts: string } {
  return format === 'cjs'
    ? { js: '.cjs', dts: '.d.cts' }
    : { js: '.js', dts: '.d.ts' }
}

export default defineConfig([
  {
    entry: {
      'index': 'src/index.ts',
      'shared/index': 'src/shared/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    platform: 'neutral',
    target: 'es2022',
    outExtensions,
    deps: {
      neverBundle: [/^node:/],
    },
    exports: false,
  },
  {
    entry: {
      'cli/index': 'src/cli/index.ts',
      'env/index': 'src/env/index.ts',
      'local/index': 'src/local/index.ts',
      'storage/index': 'src/storage/index.ts',
      'commands/index': 'src/commands/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    platform: 'node',
    target: 'es2022',
    outExtensions,
    exports: false,
  },
  {
    entry: {
      'proxy/index': 'src/proxy/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: false,
    platform: 'neutral',
    target: 'es2022',
    outExtensions,
    exports: false,
  },
  {
    entry: {
      'bin/proxy': 'src/bin/proxy.ts',
    },
    format: ['esm'],
    dts: false,
    clean: false,
    platform: 'node',
    target: 'es2022',
    outExtensions,
    exports: false,
  },
])
