# devkit：本地开发基建的单一实现

> 状态：草案（2026-11-19）。事实依据见 [current-state.md](./current-state.md)。
> 本文定义包形态、公开 API、行为契约与迁移阶段；实现完成前不得把「将支持」写成「已支持」。

## 1. 问题

同一个人的多个项目重复实现同一套本地开发基建，且已经分叉：CLI 的行为、环境变量的语义、代理的启动方式各自演进，修一处 bug 要改两遍。复制粘贴无法解决同步问题，只能把代码收敛成一份可版本化的依赖。

## 2. 目标

| 编号 | 目标 | 验收信号 |
|---|---|---|
| FR-1 | 单一实现：本地开发基建只有一份源码，下游以依赖引入 | 下游 `git grep` 不到重复的 runtime / dev-services / dev-silo |
| FR-2 | 可配置：项目差异全部经配置注入，源码中无项目常量 | 配置外 `grep -r "ymmt\|tweets-viewer\|ymmt_dev" src/` 无结果 |
| FR-3 | 机器契约：`--json` 单行信封、固定退出码、`describe`、日志走 stderr | 契约测试覆盖 0/1/2/3 四种退出码与信封字段 |
| FR-4 | 本地链路：一条命令起 Postgres + 建库 + 迁移 + `/sql` 代理 + SILO，后台复用 | 停掉代理后 `dev` 能重新拉起；`/health` 的库名与连接目标一致 |
| FR-5 | 环境隔离：`LOCAL` 与 `*_ONLINE` 的优先级固定，线上模式拒绝本机库 | 优先级矩阵单测；混合状态被拦下并给出下一步 |
| FR-6 | 运行时边界：Worker 只能引用纯入口，Node/Bun 能力隔离在子路径 | 入口矩阵测试 + 浏览器目标构建断言 |
| FR-7 | 文档单一：参数化指南在 devkit，下游只写差异与专属排障 | 下游文档不再复制原理段落 |
| FR-8 | 可发布：公开 npm 包，peer 依赖不强迫下游升级 | `bun pm pack --dry-run` 只含预期文件；fixture 安装可运行 |
| FR-9 | 可验证：单元 + 集成 + 下游冒烟三层，验证必须携带信号 | CI 与发版检查表逐项可执行 |

## 3. 非目标

- **不是框架**：不接管业务命令树（抓取、ingest、publish、validate）。
- **不承诺跨运行时**：`/sql` 代理基于 `Bun.serve`，与两个下游一致；Node 适配列入开放问题，不在 0.1 实现。
- **不做云端编排**：不创建 Neon / R2 / 域名，不替代 wrangler。
- **不做多租户**：一次配置对应一个项目；不读取其他项目的配置。
- **不追求零依赖**：CLI 需要 `commander`，存储策略需要 `aws4fetch`；`pg` / `drizzle-orm` 走可选 peer。

## 4. 关键决策

| 编号 | 决策 | 选项与取舍 |
|---|---|---|
| D1 | 独立仓库 + **可发布包** | 复制模板已证明会漂移；monorepo 会把发布周期不同的应用绑在一起；放进 `starter-ts-lib` 会破坏其零运行时依赖定位 |
| D2 | **单包 + subpath exports** | 拆 4 个包会让 peer 与版本矩阵过早复杂化；单包用子路径隔离运行时，超过阈值再拆（见 §14） |
| D3 | 代理保持 **Bun-only** | 与现有两套实现一致，避免重写协议细节；Node 适配等真实需求出现再做 |
| D4 | 发布到 **公开 npm** | 无密钥、CI 免登录；git 依赖会让 CI 依赖仓库权限与网络路径 |
| D5 | 纯函数允许 Worker 引用（`./shared`） | 只放 URL 判定、env 文本解析等零依赖函数；构建目标为 neutral，测试断言无 `node:` 导入 |

## 5. 包形态

### 5.1 仓库结构

```text
src/
├─ index.ts                 # defineDevkit + 公开类型；无 node/bun 导入
├─ shared/                  # 纯函数：URL 判定、env 文本解析、本地地址推导
├─ cli/                     # runtime / envelope / exit / logger / describe
├─ env/                     # 环境文件加载、LOCAL 覆盖、*_ONLINE 展开、环境描述
├─ local/                   # Postgres 编排、建库、迁移、env 文件写入、本地栈编排
├─ proxy/                   # Neon /sql 协议翻译（Bun.serve）
├─ storage/                 # SILO / MinIO 编排与桶策略
├─ commands/                # 内置 dev 命令组
└─ bin/
   └─ proxy.ts              # 后台代理入口，由 local 编排按绝对路径 spawn
tests/                      # 镜像 src/
docs/                       # 索引见 docs/README.md
```

### 5.2 入口矩阵

| 入口 | 内容 | 构建目标 | 可进 Worker |
|---|---|---|---|
| `.` | `defineDevkit`、配置类型 | neutral | 是（仅纯函数与类型） |
| `./shared` | `isLocalUrl` / `isLocalMode` / `parseEnvContent` / `localPublicBase` | neutral | 是 |
| `./cli` | `CommandSpec`、`buildCli`、`runCli`、logger | node | 否 |
| `./env` | 加载与覆盖环境文件 | node | 否 |
| `./local` | Postgres 生命周期、建库、迁移、本地栈编排 | node | 否 |
| `./proxy` | `/sql` 代理 | bun | 否 |
| `./storage` | SILO 生命周期、桶与匿名读策略 | node | 否 |
| `./commands` | `createDevCommands()` | node | 否 |
| `./bin/proxy` | 可执行入口（shebang bun） | bun | 否 |

`package.json#exports` 与 `tests/exports.test.ts` 同步锁定；新增或删除入口都算公开契约变化。

### 5.3 依赖策略

| 依赖 | 形式 | 理由 |
|---|---|---|
| `commander` | dependency | CLI 入口必需，版本由 devkit 控制 |
| `aws4fetch` | dependency | 桶策略签名，体积小 |
| `pg` | optional peer | 下游已有自己的版本；`./proxy` 与迁移需要 |
| `drizzle-orm` | optional peer | 迁移器 API 与下游版本绑定 |
| `typescript` / `vitest` / `tsdown` | devDependency | 不泄漏到下游 |

- `engines`：`node >= 22.22`（与 ymmt 一致），`./proxy` 额外要求 Bun `>= 1.4.4`。
- 不引入 `dotenv`：env 文件解析已有实现，且需要保留注释与行序。
- 下游用精确版本（`"@chilfish/devkit": "0.1.0"`），升级走独立 PR。

## 6. 公开 API

### 6.1 配置

```ts
import { defineDevkit } from '@chilfish/devkit'

export const devkit = defineDevkit({
  identity: {
    name: 'ymmt',
    description: '夢限大みゅーたいぷ 数据流水线',
    helpHint: 'bun run ymmt',
    jsonEnvVar: 'YMMT_JSON',
  },
  env: {
    file: '.dev.vars',
    localFlag: 'LOCAL',
    onlineSuffix: '_ONLINE',
  },
  database: {
    localUrl: 'postgres://postgres@localhost:5432/ymmt_dev',
    proxyEndpoint: 'http://127.0.0.1:4444/sql',
    migrations: 'drizzle',
  },
  storage: {
    bucket: 'yumemita-data',
    dataDir: 'temp/silo-data',
    publicBaseEnv: 'PUBLIC_R2_BASE',
  },
  paths: { logs: 'temp' },
  dev: {
    servers: [
      { name: 'astro', runtime: 'node', command: 'astro', args: ['dev'] },
    ],
  },
})
```

字段约束：

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `identity.name` | 是 | — | CLI 名，写进帮助与信封 `command` 前缀 |
| `identity.description` | 是 | — | 根命令说明 |
| `identity.helpHint` | 否 | `bun run <name>` | 错误提示里的下一步 |
| `identity.jsonEnvVar` | 否 | — | 隐式 JSON 开关，如 `YMMT_JSON` |
| `env.file` | 是 | — | 相对仓库根的环境文件 |
| `env.localFlag` | 否 | `LOCAL` | 总开关变量名 |
| `env.onlineSuffix` | 否 | `_ONLINE` | 线上目标后缀；不需要则不展开 |
| `database.localUrl` | 是 | — | `LOCAL=1` 时的库地址 |
| `database.proxyEndpoint` | 是 | — | `/sql` 代理地址 |
| `database.migrations` | 是 | — | drizzle 迁移目录 |
| `storage.bucket` | 否 | — | 本地桶名 |
| `storage.dataDir` | 否 | `temp/silo-data` | SILO 数据目录 |
| `storage.publicBaseEnv` | 否 | — | `LOCAL=1` 时写入派生媒体地址的变量名 |
| `paths.logs` | 否 | `logs` | 后台服务日志目录 |
| `dev.servers` | 是 | — | 至少一个；见 6.6 |

`defineDevkit` 只做校验与冻结：不读文件、不改 `process.env`、不打印。

### 6.2 CLI

```ts
import { buildCli, runCli } from '@chilfish/devkit/cli'

const program = buildCli({
  config: devkit,
  version,
  groups,
  rootCommands,
})
await runCli(program, process.argv.slice(2))
```

- `CommandSpec` / `CommandGroup` / `CommandContext` 沿用现有形状，`toArgv`、`requireString`、`integer`、`flag` 保留。
- runtime 负责：帮助中文化、全局选项、日志器、环境横幅、JSON 信封、退出码、`describe` 子命令。
- 项目名、提示语、隐式 JSON 变量从 `config` 读取；runtime 不 import 任何项目文件。

### 6.3 环境

```ts
import { loadEnvFile, describeEnvironment } from '@chilfish/devkit/env'
import { isLocalMode, isLocalUrl } from '@chilfish/devkit/shared'

loadEnvFile({ config: devkit })
const banner = describeEnvironment(process.env, devkit)
```

行为固定为：

1. 读 `env.file`，只补进程环境里没有的键；显式变量始终优先。
2. `LOCAL` 的取值顺序：进程环境 > 文件。
3. `LOCAL=1`：忽略 `*_ONLINE`，强制 `DATABASE_URL` / `NEON_HTTP_ENDPOINT` 指本机，写入 `storage.publicBaseEnv`（若配置）。
4. `LOCAL=0`：把 `*_ONLINE` 展开成同名键，进程环境仍优先；若 `DATABASE_URL` 指向本机则清掉并提示。
5. 横幅只输出模式、库主机/库名、本地桶地址；不输出账号密码。

`isLocalUrl` 认 `localhost` / `127.0.0.1` / `[::1]`；不做模糊匹配。

### 6.4 本地数据库

```ts
import { ensureDevServices } from '@chilfish/devkit/local'
const { databaseUrl, endpoint } = await ensureDevServices({ config: devkit })
```

内部提供、也单独导出：

- `resolvePostgresInstall()`：`PG_CTL` → `PATH` → Scoop → 安装目录；`PGDATA` 优先。
- `ensurePostgresRunning()`：已在运行则复用；失败时附日志尾部。
- `ensureDatabase()`：数据库名白名单校验后建库。
- `applyMigrations()`：使用 `config.database.migrations`。
- `ensureEnvFile()`：只改配置声明的键，保留注释、空行与其他行（含 `*_ONLINE`）。

### 6.5 代理

```ts
import { createProxyHandler } from '@chilfish/devkit/proxy'
```

- `createProxyHandler({ databaseUrl })`：纯 handler，便于进程内启动与单测。
- `startProxy({ databaseUrl, port })`：`Bun.serve` 包装，返回 `{ url, close }`。
- 后台入口 `./bin/proxy`：读 `DATABASE_URL` / 端口，由本地栈编排按**包内绝对路径** spawn。
- 只接受本机库地址；`/health` 返回 pid、host、database、查询计数。

### 6.6 dev 命令组

```ts
import { createDevCommands } from '@chilfish/devkit/commands'

const devGroup = createDevCommands(devkit)
```

生成 `dev db` / `dev proxy` / `dev storage` / `dev server`：

- `dev server` 按 `dev.servers` 启动全部进程，转发信号与退出码；`--` 之后的参数透传给**第一个** server（多目标透传列入开放问题）。
- `dev proxy` 前台运行；`dev db`、`dev storage` 只准备对应服务。
- 全局 `--dry-run` 对四条命令都只报告步骤，不起进程、不写文件。

### 6.7 存储

```ts
import { ensureSiloRunning, ensureLocalBucket } from '@chilfish/devkit/storage'
```

- 二进制查找：`SILO_BIN` → `PATH` → Scoop → `minio` 回退。
- 启动参数、数据目录、控制台端口来自配置与环境；日志写入 `paths.logs`。
- 桶与匿名读策略用 `aws4fetch` 签名；凭据由调用方传入，devkit 不解析 R2 语义。

## 7. 运行时边界

- 只有 `.` 与 `./shared` 是 neutral 构建，其余入口声明 `platform: 'node'`；`./proxy` 与 `./bin/proxy` 额外标注 Bun 运行时。
- `tests/` 增加「浏览器目标构建」用例：对 `./shared` 产物执行 `bun build --target=browser`，断言不出现 `node:` / `bun:` 内建。
- 下游在 Worker 侧禁止新增导入：在 ESLint 配置里对 `src/**` 加 `no-restricted-imports`，禁止 `@chilfish/devkit/{cli,env,local,proxy,storage,commands}`。接入指南给出可直接复制的配置片段。
- 迁移期例外：`astro.config.mjs` 可以引用 `./shared` 与 `./env`（构建期，不打包进 Worker）。

## 8. 行为契约

| 项 | 契约 |
|---|---|
| 退出码 | `0` 成功 / 已收敛；`1` 运行期失败（部分失败也算）；`2` 用法错误；`3` 配置缺失 |
| stdout | 只放命令数据与 `--json` 信封；日志、横幅、帮助正文走 stderr |
| `--json` | 单行信封：`{ ok, command, data, error, meta }`；`meta.mode` 为 `local` / `remote` |
| `--dry-run` | 不写库、不写对象存储、不写文件、不起进程 |
| 环境横幅 | 每条命令开工前一行：模式 · 数据库主机/库名 · 本地桶地址 |
| 后台服务 | Postgres / 代理 / SILO 不随前台命令退出；重复执行先健康检查再复用；端口被别的库占用时直接报错 |
| 日志文件 | `paths.logs` 下按服务命名；NDJSON 只在 `--log-file` 显式开启 |
| 错误 | 稳定 `code` + `message` + `hint`（可照抄的下一步）+ `context`；堆栈只在 `debug` 输出 |

## 9. 模块回收映射

| devkit 模块 | 回收自 | 需要参数化 | 备注 |
|---|---|---|---|
| `cli/runtime` | ymmt `scripts/lib/cli/runtime.ts` | 名称、提示、JSON 变量、env 加载 | 合入 tweets 的 `describeError`（展开 `cause`） |
| `cli/envelope` / `exit` / `logger` | ymmt 同名文件 | 无 | 直接搬 |
| `env/load` | ymmt `scripts/lib/env.ts` | 文件、后缀、派生键 | 合入 tweets 的 `applyLocalDefaults` 与多库解析（可选） |
| `env/online` | ymmt `scripts/lib/online-env.ts` | 后缀 | 只做展开与恢复，不涉及项目凭据 |
| `env/mode` | ymmt `local-config.ts` + tweets `shared` | 本地默认值 | 拆成纯函数，去掉 `process.env` 默认参数 |
| `local/postgres` | ymmt `dev-services.ts` | 日志目录 | 定位逻辑原样保留 |
| `local/database` | 同上 | 迁移目录 | 建库 + drizzle migrate |
| `local/envfile` | ymmt `ensureDevVars` + tweets `ensureLocalEnv` | 文件名与键 | 保留两边的「不覆盖已有值」语义 |
| `local/proxy` | ymmt `commands/dev/proxy.ts` | 包内入口路径 | 修复旧脚本路径失效 |
| `storage` | ymmt `dev-silo.ts` | 桶、目录、端口 | 凭据由调用方传入 |
| `commands/dev` | ymmt `commands/dev/*` | `dev.servers` | 支持多进程（tweets 的 server + client） |

**不回收**：抓取/ingest/publish/validate、R2 远端解析、框架配置、部署与冒烟命令。

## 10. 迁移阶段

每个阶段结束时下游必须可运行；不允许长期保留两份实现。

### S0 下游止血与接口冻结（在 ymmt 内）

- S0-1 修复代理入口：把代理主体抽成可复用函数，命令与编排共用同一入口；`ensureDevProxy` spawn 绝对路径。
- S0-2 新增 `scripts/dev.config.ts`，把 §3 的常量收敛到一处，runtime / env / local 从配置读取。

**验收**

- 停掉 4444 代理后 `bun run dev` 能自动拉起；`curl http://127.0.0.1:4444/health` 的 `database` 为 `ymmt_dev`；页面读库正常。
- `git grep "scripts/dev-db-proxy.ts" -- scripts/` 无结果。
- `bun run check` 通过；`bun run ymmt describe --json` 与改动前的结构一致（仅版本号可变）。

### S1 建包并发布 0.1.0（本仓库）

- 重命名包与仓库元信息；按 §5 建立入口与目录；搬移 §9 的模块。
- 补齐单测与契约测试；`CHANGELOG` 记录首个可用版本。
- 发布 `@chilfish/devkit@0.1.0`。

**验收**

- `bun run check` 通过；`bun run test:coverage` 覆盖配置、env 优先级、env 文件写入、退出码、入口矩阵。
- `bun pm pack --dry-run` 只含 `dist/`、`README.md`、`LICENSE.md`、`package.json`。
- 在临时 fixture 项目中安装 tarball 后：`--help`、`describe --json`、`dev --help` 可用；代理能查询 `select 1`；`/health` 返回目标库。

### S2 ymmt 切换

- 删除本地副本，改为依赖 `@chilfish/devkit`；保留 `scripts/dev.config.ts` 与业务命令。

**验收**

- `git grep` 不到 `buildEnvelope` / `CommandSpec` / `ensureSiloRunning` 的本地实现。
- `bun run check`、`bun run build` 通过。
- `bun run ymmt describe --json` 与 S0 快照逐字段一致（版本除外）。
- 从「Postgres 在跑、代理不在」的状态执行 `bun run dev`，全套服务就绪、页面返回 200。
- `bun run ymmt db verify`、`bun run ymmt validate data` 通过。

### S3 tweets 切换

- 删除重复的 CLI / dev-services / dev-storage / local-config 实现；`dev` 命令组改用 devkit。
- 把 `describeError`、多库解析等独有能力回收到 devkit（不改变 ymmt 现有行为）。

**验收**

- `bun run ig ins verify <账号> --json | jq .meta.mode` 为 `local`。
- `bun run dev` 同时启动 server 与 client；`/v3/users/all` 条数与本地导入一致。
- `bun run test` 通过；两仓库不再有同名基建文件。

### S4 文档收敛

- 本仓库新增参数化指南与配置参考（见 §12）。
- 下游 `local-database.md` 收缩为差异页（建议 ≤ 120 行），`cli.md` 只保留本项目命令树 + 链接。

**验收**

- `bun run check:docs` 通过；指南中的路径与命令全部可执行。
- 下游文档不再出现「为什么需要代理」这类原理段落的复制；两类文档各自只保留一份。
- 按指南在 fixture 中从零接入成功，无需阅读下游源码。

### S5 脚手架（可选）

- 触发条件：第三个项目接入，或同一套手工步骤重复出现三次以上。
- 形态：`devkit init` 或独立 starter（复用本仓库发布链），生成 `dev.config.ts` 与文档骨架。
- 未触发前不实现。

## 11. 测试策略

| 层 | 覆盖 | 触发 |
|---|---|---|
| 单元 | 配置校验、env 优先级矩阵（进程/文件/`LOCAL`）、`*_ONLINE` 展开与恢复、env 文件写入保序、URL 判定、横幅脱敏、信封与退出码、帮助中文化 | 每次 `bun run check` |
| 集成 | 临时库建库 + 迁移、代理单查询/批量查询/`/health`、端口占用检测；SILO 可选 | `DEVKIT_PG_SMOKE=1`；CI 有 Postgres 服务时 |
| 契约 | 入口矩阵形状、`./shared` 浏览器目标构建、`package.json#exports` 与测试同步 | 每次 CI |
| 下游冒烟 | 两个下游的 `check` / `build` / 本地链路 | 发版前、升级 peer 依赖的 PR |

修复任何 bug 先补能失败的复现用例（沿用仓库既有规范）。

## 12. 文档策略

本仓库文档（S4 落地，落地前以代码为准）：

| 文档 | 内容 |
|---|---|
| `docs/guide/getting-started.md` | 安装、写配置、接入 CLI、接入 dev 命令 |
| `docs/guide/local-dev.md` | Postgres / 代理 / SILO 的原理、操作、停止与重置 |
| `docs/guide/cli.md` | `CommandSpec`、`--json`、退出码、日志、`describe` |
| `docs/reference/config.md` | 配置字段、默认值、校验规则 |
| `docs/reference/api.md` | 八个入口的导出面 |
| `docs/reference/commands.md` | 内置 `dev` 命令与选项 |
| `docs/engineering/architecture.md` | 分层、入口矩阵、运行时边界 |
| `docs/engineering/dependencies.md` | peer 策略与升级流程 |
| `docs/engineering/testing.md` | 三层测试与 fixture 方法 |

下游文档模板（差异页，四节固定）：

1. 本项目参数：库名、桶、迁移目录、环境文件、dev 服务器。
2. 起停与重置：只写与通用流程不同的部分。
3. 本项目特有症状：只在其他项目不会出现的。
4. 链接：原理、通用排障、命令参考全部指向 devkit。

禁止在任何下游文档复制参数化指南的正文；发现重复时删项目侧，保留链接。

## 13. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| peer 依赖漂移（`pg` / `drizzle-orm`） | 下游升级互相阻塞 | optional peer + 版本区间；发版前跑两个下游的 check |
| Bun-only 代理 | Node 脚本项目无法使用 | 文档标注；Node 适配列入开放问题 |
| Windows 后台进程（`cmd start`、fd 继承） | 代理/SILO 起不来 | 保留现有实现；失败输出日志尾部；集成冒烟覆盖「未运行时自动拉起」 |
| 迁移期双源 | 修一处漏一处 | S2/S3 完成立即删除本地副本，不做「临时保留」 |
| env 语义差异（`.dev.vars` + `*_ONLINE` vs `.env` + `DATABASE_URL_REMOTE`） | 强行统一会破坏下游 | 配置化；统一与否等第三个项目再定 |
| 过度抽象 | 包变重、API 反复破坏 | 只回收已出现两次的能力；新增能力先写方案与下游用例 |
| 文档再漂移 | 两份指南 | 下游只写差异；review 检查「原理段落是否复制」 |

## 14. 开放问题

1. `./proxy` 是否需要 Node 适配（`node:http`）？触发条件：出现非 Bun 的脚本项目。
2. `*_ONLINE` 与 `DATABASE_URL_REMOTE` 是否统一？倾向不统一，等第三个消费者。
3. 远端对象存储解析（R2 凭据、CDN 前缀）是否进包？目前语义不同，暂不回收。
4. `dev server` 多进程的参数透传语义：是否需要 `--target <name>`。
5. 是否提供 `devkit doctor`（检查 pg / silo / 端口 / env 文件一致性）？倾向 0.2。
6. 单包拆多包的阈值：源码超过约 2500 行，或出现两个运行时，或第三个消费者。
7. `devkit init` 与独立 starter 二选一，S5 再定。

## 15. 完成定义

- 两个下游不再包含重复的本地基建源码；每项目配置不超过约 40 行。
- 两个下游的 `check` / `build` / 本地链路全部通过。
- 入口矩阵、env 优先级、退出码有可失败的测试。
- 新项目按指南可从零接入，无需阅读下游实现。
- `docs/README.md` 索引完整，`bun run check:docs` 通过。
- `CHANGELOG` 记录 0.1.0 的能力边界与已知限制。
