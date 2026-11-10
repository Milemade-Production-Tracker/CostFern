# CostFern

CostFern is an embedded Shopify app for reviewing supplier cost changes. It compares two CSV quotes against the shop’s variants, records line decisions and exports an immutable list of approved costs. Shopify catalog access uses read_products. Reviews and approvals are stored in PostgreSQL.

See the [development handoff](docs/DEVELOPMENT-HANDOFF.md) for recovery on another computer, the App Store submission record and the hosted release.

## Local development

Use Node.js 22.12 or newer, Shopify CLI and a local PostgreSQL instance. Copy .env.example to the ignored .env file and set DATABASE_URL to your CostFern database. For database tests, also set COSTFERN_TEST_DATABASE_URL to a separate localhost database named costfern_test and apply the same Prisma migrations to it. Replace the example store domain in the commands with the development store authorized for your app.

```powershell
npm.cmd ci
$env:RUST_LOG = 'info'
npm.cmd run setup
shopify app dev --config shopify.app.toml --store your-dev-store.myshopify.com
```

Open the CLI preview link in the signed-in Shopify browser. The app uses the existing CostFern entry in Dev Dashboard. For a new local database, run setup before opening the app. RUST_LOG=info also works around the Prisma schema-engine startup failure observed on this Windows host.

## Review workflow

1. Create a supplier with a unique code and a default currency.
2. Upload the previous and proposed UTF-8 CSV quotes. Both use sku, unit_cost, currency and the same ISO currency. Each file is limited to 2 MB.
3. Verify Shopify matches, resolve ambiguous variants, approve rows or explicitly exclude them with a reason.
4. Finalize the reviewed batch, then download the approved CSV. An immutable finalized revision can be downloaded again from History. A correction has its own revision and retains the original batch’s quota charge.

The approved CSV contains supplier, variant ID, SKU, previous and proposed costs, currency, revision and decision time. CostFern stores parsed rows and source fingerprints. The import does not persist raw upload files.

## Plans

| Plan | USD price | Monthly reviews | Rows per review | Included features |
| --- | --- | ---: | ---: | --- |
| Starter | $39 monthly, eligible 3-day trial | 10 | 500 | Import, match, review, finalize and approved CSV |
| Growth | $79 monthly or $790 annually | 50 | 2,000 | Starter features, supplier filtering and version comparison |
| Pro | $129 monthly or $1,290 annually | 150 | 5,000 | Growth features, cross-supplier summary and audit CSV |

The first successful finalization consumes one review. Imports, retries, corrections of the same batch and downloads preserve usage. Each quota window starts on the shop’s first verified entitlement anchor in UTC. Short months clamp to their last day and longer months restore the anchor day. The same window applies through trial conversion, plan changes and annual billing. Finalized approved CSVs remain available after a downgrade, expiration or exhaustion of the monthly allowance.

### Development plan simulation

Set these variables in the PowerShell session before starting the preview. Use starter, growth or pro, then restart to switch tiers. The override requires a Shopify-confirmed development store, the exact configured domain and the development runtime. Simulated usage has its own quota window.

```powershell
$env:COSTFERN_DEV_SHOP = 'your-dev-store.myshopify.com'
$env:COSTFERN_DEV_TIER = 'starter'
$env:RUST_LOG = 'info'
shopify app dev --config shopify.app.toml --store your-dev-store.myshopify.com
```

### Shopify App Pricing

Shopify App Pricing is configured with three public plans and five recurring choices. Their handles are `starter`, `growth` and `pro`, with `/app/plan` as the welcome path for each. The app checks the authoritative subscription through the Partner API before granting plan access. Set the following in the server environment.

- SHOPIFY_PARTNER_ORG_ID, SHOPIFY_PARTNER_API_ACCESS_TOKEN with Manage apps access, and SHOPIFY_APP_GID for CostFern
- SHOPIFY_APP_HANDLE for the Shopify-hosted pricing link
- COSTFERN_STARTER_HANDLE, COSTFERN_GROWTH_HANDLE and COSTFERN_PRO_HANDLE if Shopify uses plan handles other than starter, growth and pro
- COSTFERN_PRICING_TEST_SHOP only when enabling the private `shopify-test` alias for a designated development store. It requires Shopify to verify the store's development status and return an active USD 0 monthly contract for the private handle.

Use the normal Shopify runtime credentials for authentication. [Hosted plan selection](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/redirect-plan-selection-page) · [Partner active subscription](https://shopify.dev/docs/api/partner/2026-07/active-subscription)

## Verification

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
shopify app config validate --json
```

Database tests require the migrated costfern_test database. They exercise persisted reviews at each tier’s row limit, the last available quota slot, concurrent finalization, duplicate imports, corrections, CSV safety, tenant isolation and lifecycle cleanup. The application also validates five subscription choices and the development-only entitlement gate.

On November 9, 2026, the development store returned five marked draft variants through Admin API 2026-07, including a duplicate SKU and a variant with no SKU. Using a QA draft staged through the import service, Starter finalized two approvals and produced matching CSVs on the first download and after reload. Growth finalized a correction without using another slot, compared the two versions and filtered by supplier. Pro finalized a second supplier, displayed both in the summary and downloaded the three-event approval audit.

With the development override disabled, the hosted pricing link opened Shopify’s approval flow for the free `shopify-test` plan assigned to the designated development store. Shopify returned to `/app/plan` with `plan_handle=shopify-test`. The Partner API confirmed an active USD 0 subscription on a 30-day cycle, and CostFern displayed Starter with 0 of 10 reviews used. The dedicated `COSTFERN_PRICING_TEST_SHOP` setting preserves this alias alongside the canonical Starter handle.

Local browser checks rendered the review component with test data in 480 px and 1000 px frames. The narrow frame showed cards, kept long amounts within their columns, and had no horizontal page overflow. The wide frame showed the table. The finalized development-store review also rendered as cards inside Shopify Admin at a 480 px browser viewport. The embedded page did not scroll horizontally, and opening the Fern card showed the original and proposed amounts with both source filenames and row numbers.

The multipart tests verify exact source fingerprints, UTF-8 validation, the per-file limit, and the streamed request limit. On the $0 Shopify test subscription, the user selected both sample files in Chrome and the review was then submitted through the embedded form for `CF-QA-STARTER`. The upload produced seven rows with matching source fingerprints. The review recorded two approvals and five exclusions, including a manually resolved Shopify match. The first download and the download after reload both contained only the two approved rows and matched the stored export hash. This used one review in the verified Starter allowance.

Browser quota checks used two tagged, reviewed drafts per tier and preloaded only the simulated monthly usage to 9, 49, or 149. The 10th, 50th, and 150th finalizations succeeded. A second submission from the previously opened confirmation dialog received the server’s monthly limit error on each tier, and the fresh page disabled finalization. Growth filtered a real supplier and compared its two finalized versions. Pro showed the cross-supplier summary and exported an existing three-event audit CSV while its allowance was full. The PostgreSQL and multipart tests accepted exactly 500, 2,000, and 5,000 rows and rejected each limit plus one. Large row-boundary files were tested through the server, with the browser used for the uploaded sample and monthly quota checks. The temporary quota fixtures were removed, the simulated ledger was restored, and the preview was returned to the verified $0 subscription.

All five configured choices were approved as no-charge tests in Shopify Admin. Each returned to `/app/plan` with its canonical handle. Partner API readback confirmed USD 0 for every contract and the matching 30-day or annual interval. Starter showed the three-day trial. Growth and Pro showed the correct monthly or annual billing state and their monthly review allowances. The same finalized review stayed counted once through all plan changes. The development store was left on the Pro annual USD 0 test contract, with supplier summaries and audit download available. The public plans and their English display names and features are saved in the App Store listing draft.

The approved [UI proposal](design-preview/README.md) is implemented on Review Queue, Cost Review, Suppliers, History and Plan. Shopify's native navigation remains the workspace entry point. The review hero uses a labeled illustrative image, while row thumbnails still use the shop's catalog images when available.

The development-store UI regression on November 9, 2026 confirmed native two-file upload and duplicate reopening, supplier create/edit and duplicate-code validation, SKU matching and decision validation, linked correction navigation, locked CSV and audit downloads, History filtering and comparison, and Plan price comparison plus the Shopify-hosted link. At a 480 px browser viewport, the seven review rows became cards without page-level horizontal scrolling. Temporary QA suppliers and corrections were removed after verification. The original export hash and the 1 of 150 usage ledger matched baseline, and Partner API readback confirmed the Pro annual USD 0 contract.

The hosted release passed development-store review and export checks with the Shopify Admin API IP allowlist enforced. The owner reported manually submitting the app on November 10, 2026. The [development handoff](docs/DEVELOPMENT-HANDOFF.md) records the release identifiers and verification scope.
