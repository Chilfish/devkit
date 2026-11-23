import { defineConfig } from 'tsdown'

/**
 * Three build targets:
 * - neutral: `.` and `./shared`, no node/bun builtins, safe for Workers and browsers;
 * - node: CLI, env, local, storage and commands, may use `node:*`;
 * - bun runtime: `./proxy` (`Bun.serve`, `pg`) and `./bin/proxy` (shebang). tsdown
 *   has no `bun` platform, so both use `node`, which only decides what is bundled.
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
      // Internal, resolved by absolute path next to `pipeline/index`: the public
      // subpath is `./pipeline`, the worker entry is not importable by consumers.
      'pipeline/worker-entry': 'src/pipeline/worker-entry.ts',
      'pipeline/index': 'src/pipeline/index.ts',
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
    // tsdown has no `bun` platform: `node` keeps `pg` external instead of
    // bundling it. This entry still calls `Bun.serve` and is Bun-only at runtime.
    platform: 'node',
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
    // Bun-only executable; `node` is the closest available platform.
    platform: 'node',
    target: 'es2022',
    outExtensions,
    exports: false,
  },
])
