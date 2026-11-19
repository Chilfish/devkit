# 现状审计：本地开发基建的重复与分叉

> 审计日期：2026-11-19。审计对象：`yumemita-stream-dashboard`（下称 ymmt）、`tweets-viewer`（下称 tweets）、本仓库当前形态（starter-ts-lib 的干净副本）。
> 本文只记录事实与量化结果，方案见 [devkit-design.md](./devkit-design.md)。

## 结论

1. 两边共用同一套本地开发基建：CLI runtime、本地 Postgres 编排、Neon HTTP `/sql` 代理、SILO（S3）编排、`LOCAL` 环境开关。可复用的实现约 **1.8k 行**。
2. 代码已经分叉：`cli/runtime.ts` 新增+删除合计 240 行；`dev-services.ts` 265 行；`local-config.ts` 192 行。其中大部分是格式化风格差异，功能差异集中在少数几处（见 §2）。
3. 分叉的主体是**项目常量**，不是逻辑：库名、迁移目录、环境文件名、日志目录、桶名、媒体地址变量、dev 服务器命令。这些都可以由一份配置注入（见 §3）。
4. 复制模式下已经出现一处真实回归：代理脚本路径失效（见 §4）。这类问题靠人工同步无法避免。

## 1. 重复面

数据来自 `Compare-Object` 与 `git diff --no-index`（2026-11-19）。差异行数 = 新增 + 删除。

| 文件 | ymmt | tweets | 差异行数 | 差异性质 |
|---|---:|---:|---:|---|
| `cli/runtime.ts` | 536 | 550 | 240 | 格式化占多数；功能差异见 §2 |
| `cli/envelope.ts` | 52 | 56 | 8 | 格式化 |
| `cli/exit.ts` | 74 | 76 | 10 | 格式化 |
| `cli/logger.ts` | 102 | 125 | 79 | 格式化 |
| `local-config.ts` | 81 | 167 | 192 | 语义重构（tweets 下沉到 `@tweets-viewer/shared`） |
| `dev-services.ts` | 418 | 441 | 265 | 常量 + 环境文件语义 |
| `dev-silo.ts` / `dev-storage.ts` | 210 | 237 | 145 | 常量 + 凭据来源 |
| `commands/dev/proxy.ts` | 约 150 | 独立实现 | — | ymmt 从脚本迁到命令后，tweets 未同步 |

`dev-db-proxy.ts` 在 ymmt 中被纯 rename 成 `commands/dev/proxy.ts`（`02d45f7`，相似度 100%），编排代码没有跟着改，见 §4。

## 2. 已经发生的功能分叉

| 能力 | ymmt | tweets | 影响 |
|---|---|---|---|
| `describe` 子命令 / `describeCli` | 有 | 有 | 同源，未分叉 |
| `CommandContext.toArgv` | 有 | 无 | ymmt 用它在迁移期复用旧 `main(argv)` |
| 错误原因展开（`cause`） | 无 | 有 | ymmt 的 Drizzle 错误只看到外层消息 |
| 隐式 JSON 开关 | `YMMT_JSON=1` | 无 | 写死项目名 |
| runtime 内加载环境文件 | 有 | 无（调用方加载） | 初始化顺序不同 |
| `isLocalMode(env)` 可注入 | 有 | 无参，内部读 `process.env` | 单测友好度差异 |
| 本地/线上存储统一解析 | 无（项目内 `object-storage.ts`） | `resolveStorage()` | 两边各有一套 R2 解析 |
| 多数据库地址 | 无 | 有（逗号分隔，每日抓取并行写多个归档库） | 仅 tweets 需要 |
| 环境文件与线上目标 | `.dev.vars` + `*_ONLINE` | `.env` + `DATABASE_URL_REMOTE` | 语义不同，不能直接合并 |

## 3. 必须参数化的耦合点

| 耦合点 | ymmt | tweets | 现在写死在哪 |
|---|---|---|---|
| CLI 名 / 帮助提示 | `ymmt` | `ig` | `cli/runtime.ts` |
| JSON 环境变量 | `YMMT_JSON` | 无 | `cli/runtime.ts` |
| 环境文件 | `.dev.vars` | `.env` | `env.ts` / `dev-services.ts` |
| 本地库名 | `ymmt_dev` | `tweets_dev` | `local-config.ts` / shared |
| 迁移目录 | `drizzle` | `packages/database/migrations` | `dev-services.ts` |
| 日志目录 | `temp/` | `logs/` | `dev-services.ts` / `dev-silo.ts` |
| 本地桶名 | `yumemita-data` | `tweets-viewer` | `local-config.ts` |
| SILO 数据目录 | `temp/silo-data` | `cache/silo-data` | `dev-silo.ts` / `dev-storage.ts` |
| 媒体派生地址 | `PUBLIC_R2_BASE` | `IG_CDN_BASE` | `env.ts` / `local-config.ts` |
| dev 服务器 | `astro dev`（Node） | server + client 两个进程 | `commands/dev/server.ts` / `dev-setup.ts` |

## 4. 缺陷：代理脚本路径失效

`yumemita-stream-dashboard/scripts/lib/dev-services.ts:332`：

```ts
const script = resolve('scripts/dev-db-proxy.ts')
```

该文件在 `02d45f7` 被 rename 成 `scripts/commands/dev/proxy.ts`，编排代码仍按旧路径 spawn。结果是：本机代理没在运行时，`bun run dev` 会拉起一个不存在的入口，轮询 `/health` 约 10 秒后以「开发代理启动失败」退出。

- 复现路径：停掉 4444 端口的代理 → `bun run dev`。
- 验证状态：静态核对（文件不存在、路径引用仍在、rename 提交为 100% 相似度）；未实跑，避免中断当前后台服务。
- 结论：提取为包时，代理入口必须由 devkit 自己解析绝对路径，不能依赖 cwd 与项目脚本布局。

## 5. 可回收 / 不回收

**回收**（两个项目都出现，逻辑与项目无关）：

- CLI runtime：参数解析、帮助中文化、JSON 信封、退出码、日志器、环境横幅
- 本地 Postgres：定位 `pg_ctl` / `PGDATA`、启停、建库、迁移、`/health` 复用
- Neon `/sql` 代理：查询、批量查询、健康检查、只接受本机库
- SILO：定位二进制、启动、建桶、匿名只读策略、日志尾部
- 环境层：文件解析、`LOCAL` 判定、`*_ONLINE` 展开、本机地址判定、环境描述
- dev 命令组：`dev db` / `dev proxy` / `dev storage` / `dev server` 的编排与提示

**不回收**（项目专属或语义未收敛）：

- 数据流水线：抓取、ingest、publish、validate、oneoff 补丁
- 远端对象存储解析（R2 凭据与 CDN 前缀）：两边语义不同，暂留项目侧
- 框架接线：`astro.config.mjs`、`vite.config.ts`、`env.server.ts`
- 部署、smoke、perf 等命令
- 测试数据与 fixture

## 6. 审计方法

```bash
# 行数
(Get-Content <a>).Count
# 差异
git diff --no-index --stat -- <ymmt> <tweets>
git diff --no-index -U0 -- <a> <b>
# 路径引用
git log --oneline --all --diff-filter=D -- scripts/dev-db-proxy.ts
git show --summary 02d45f7 | Select-String proxy
```

## 7. 未验证项

- 代理路径回归只做了静态核对，未实跑复现。
- tweets 的 SILO 与 `IG_CDN_BASE` 本地改写只在文档与代码中核对，未在本地起完整链路。
