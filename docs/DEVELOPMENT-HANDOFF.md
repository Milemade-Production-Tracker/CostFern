# CostFern 开发交接

## 审核和发布基线

2026 年 11 月 10 日，应用所有者确认已手动提交 Shopify App Store 审核。提交前，英文 Listing、图标、截图、测试说明、隐私页和演示视频已保存。Shopify 自动检查和嵌入式应用检查已通过。后续审核消息和上架状态以 Partner Dashboard 为准。 [审核页面](https://partners.shopify.com/5313519/apps/445348446209/distribution/app-store) · [英文 Listing](https://partners.shopify.com/5313519/apps/445348446209/edit_listing/en)

| 项目 | 送审基线 |
| --- | --- |
| 源码 | [GitHub `main`](https://github.com/Milemade-Production-Tracker/CostFern/tree/main)，部署源提交 `c7523970c3695ab1f9021960580d8a8a2eae7d14` |
| Shopify 应用 | [CostFern](https://dev.shopify.com/dashboard/246232426/apps/445348446209)，App ID `445348446209`，句柄 `costfern`，活跃版本 [`costfern-2`](https://dev.shopify.com/dashboard/246232426/apps/445348446209/versions/1201557831681) |
| 托管 | [DigitalOcean App Platform](https://cloud.digitalocean.com/apps/05e4fffc-1832-48dd-a341-6a24e8daa9ed)，纽约区，PostgreSQL 17，部署 ID `6782aec6-e9b8-4dc7-86b4-9e06d1668f9b` |
| GHCR 镜像 | `ghcr.io/milemade-production-tracker/costfern@sha256:5af5a5d4746a3c8ade4c86a87a631cc9a03fe8b1d1341ae1a3eb68fcf7daf867` |
| 开发店 | `costfern.myshopify.com`，已验证 Pro 年付 USD 0 测试订阅 |
| 公开材料 | [应用主页](https://costfern-fow55.ondigitalocean.app/) · [隐私政策](https://costfern-fow55.ondigitalocean.app/privacy) · [英文字幕演示视频](https://costfern-fow55.ondigitalocean.app/reviewer/costfern-demo.mp4) |

云端开发店已跑通双 CSV 导入、七行审核、两条批准和五条排除。重复下载的批准 CSV 一致，Pro 审计可下载，更正版本沿用同一额度，使用量保持 1/150。启用 US DigitalOcean AS14061 出口白名单后，云端店铺和商品查询通过。云端 PostgreSQL 的独立备份恢复演练暂无验收记录。

## 在新电脑恢复开发

1. 从桌面备份的 Git bundle 克隆 `main`，或从 GitHub 拉取仓库。只需源码时也可解压 ZIP。在 Codex 打开包含 `AGENTS.md` 和 `package.json` 的目录，先读本文和 [README](../README.md)。
2. 安装 Git、Node.js 22.12 或更新版本、npm 和 PostgreSQL 17。需要 Shopify 嵌入式预览时安装 Shopify CLI，并使用有 CostFern 和开发店权限的账号重新授权。
3. 创建由本地开发角色持有的空数据库 `costfern_dev`。将 [.env.example](../.env.example) 复制为 `.env`，把 `DATABASE_URL` 指向本地开发库。需要跑数据库测试时，再创建独立本机库 `costfern_test`，配置 `COSTFERN_TEST_DATABASE_URL` 并给测试库执行相同迁移。两者使用不同的数据库名。
4. 在项目根目录安装、迁移和构建。Windows PowerShell 使用 `npm.cmd`。若 Windows 上 Prisma 引擎启动报错，可在当前会话设置 `$env:RUST_LOG = 'info'`。

```sh
npm ci
npm run setup
npm run lint
npm run typecheck
npm run build
```

数据库测试要求测试库的主机为本机、数据库名为 `costfern_test`。在 PowerShell 中，可临时覆写 `DATABASE_URL` 给测试库执行迁移，再恢复原值。以下命令假定已从私有配置将测试库连接串设到当前终端的 `COSTFERN_TEST_DATABASE_URL`。

```powershell
$developmentDatabase = $env:DATABASE_URL
try {
    $env:DATABASE_URL = $env:COSTFERN_TEST_DATABASE_URL
    npm.cmd run setup
    if ($LASTEXITCODE -ne 0) { throw 'Test database migration failed.' }
} finally {
    $env:DATABASE_URL = $developmentDatabase
}
npm.cmd test
```

macOS 或 Linux 可用 `DATABASE_URL="$COSTFERN_TEST_DATABASE_URL" npm run setup`，然后运行 `npm test`。缺少测试库连接串时，数据库用例会跳过。测试报价见 [旧报价](../public/samples/old-quote.csv) 和 [新报价](../public/samples/new-quote.csv)。

### 连接 Shopify

本地预览显式指定 [开发配置](../shopify.app.toml) 和已获授权的开发店。该配置关联 CostFern，并启用开发预览的 URL 自动更新。预览前核对 CLI 显示的 App 与商店。送审应用的 Admin API 白名单处于强制模式，本地普通网络可能无法读取商品。需要完整嵌入式联调时，使用已授权且满足网络策略的开发环境，或使用独立开发 App 和开发店。 [Shopify CLI 预览命令](https://shopify.dev/docs/api/shopify-cli/app/app-dev) · [IP 白名单](https://shopify.dev/docs/apps/build/dev-dashboard/ip-allowlist)

```sh
shopify app dev --config shopify.app.toml --store your-dev-store.myshopify.com
```

通过授权渠道恢复运行时凭据。Shopify App 密钥来自 Dev Dashboard，Partner API 令牌来自有 Manage apps 权限的 Partner 组织。送审时两者以加密运行变量保存在 DigitalOcean。源码备份中的 `.env.example` 只提供字段。恢复时核对 Partner 组织 ID `5313519`、`SHOPIFY_APP_GID=gid://shopify/App/445348446209`、`SHOPIFY_APP_HANDLE=costfern` 和 `SCOPES=read_products`。 [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing) · [Partner API 订阅查询](https://shopify.dev/docs/api/partner/2026-07/active-subscription)

只有已指定的开发店可以使用 $0 测试订阅。需要模拟套餐时，参照 [README 的开发模拟说明](../README.md#development-plan-simulation)。生产环境的权益由 Shopify Partner API 返回。

## 接续审核和发布

先查 Partner Dashboard 的审核反馈，然后根据实际问题更新代码或 Listing。线上使用 [生产配置](../shopify.app.production.toml)，关闭 CLI 开发 URL 自动更新，OAuth 回调为 `/auth/callback`。DigitalOcean 的 `DATABASE_URL` 引用托管 PostgreSQL，启动命令由 Dockerfile 的 `npm run docker-start` 执行迁移并启动服务。

有发布授权时，从 GitHub 手动运行 [Publish CostFern image](../.github/workflows/publish-image.yml) 工作流，传入 `main` 上待发布的完整 SHA。工作流使用 PostgreSQL 17 和 512 MiB 容器验证启动，成功后从运行摘要取得镜像 digest，在 DigitalOcean 更新镜像源。按需在 Shopify 发布生产配置版本。部署后检查主页、隐私页和开发店 $0 订阅下的导入、审核和导出。 [DigitalOcean 镜像部署](https://docs.digitalocean.com/products/app-platform/how-to/deploy-from-container-images/)

如果迁移报告 `P3009`，先检查具体失败的迁移和数据库状态。首次云端部署中，受限角色执行已存在的 `public` schema 创建语句时遇到 `42501`。当时在事务中补齐原迁移的其余 DDL，核对后才将该迁移标为已应用。源码保留原迁移及校验值。

## Codex 接手提示

> 继续开发当前目录中的 CostFern Shopify App。先读 AGENTS.md、README.md 和 docs/DEVELOPMENT-HANDOFF.md。以文档中的送审版本为基线，核对当前分支、审核反馈和授权范围。开发和测试使用隔离数据库，Shopify 开发店测试使用 $0 订阅。根据我本轮的任务决定是否需要部署或修改审核材料。
