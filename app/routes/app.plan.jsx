/* eslint-disable react/prop-types */
import { useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server.js";
import { getUsage } from "../models/review.server.js";
import { getEntitlement, getPricingUrl, plans } from "../services/entitlements.server.js";
import { WorkspaceHeading, WorkspaceIcon } from "../components/workspace-ui.jsx";

export async function loader({ request }) {
  const context = await authenticate.admin(request);
  let entitlement = await getEntitlement(context);
  const returnedHandle = new URL(request.url).searchParams.get("plan_handle");
  if (returnedHandle && returnedHandle !== entitlement.planHandle && !entitlement.developmentOverride) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    entitlement = await getEntitlement(context);
  }
  const shop = context.session.shop;
  const usage = entitlement.id ? await getUsage(shop, entitlement) : null;
  return { entitlement, usage, plans: Object.values(plans), pricingUrl: getPricingUrl(shop) };
}

const features = {
  starter: ["SKU matching and cost review", "Approved-cost CSV export", "3-day trial for eligible stores"],
  growth: ["Everything in Starter", "Supplier filtering", "Finalized version comparison"],
  pro: ["Everything in Growth", "Cross-supplier summaries", "Approval audit CSV"],
};

const noPlanMessage = {
  unsubscribed: "Choose a plan in Shopify to start reviewing supplier costs.",
  unknown_plan: "Your Shopify subscription could not be matched to a CostFern plan. Check your plan in Shopify.",
  unavailable: "We could not verify your subscription with Shopify. Refresh this page to try again.",
};

const utcDateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const number = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
});

function formatUtc(value) {
  return utcDateTime.format(new Date(value)) + " UTC";
}

function billingLabel(entitlement) {
  if (entitlement.billingPeriod === "ANNUAL") return "Annual billing";
  if (entitlement.billingPeriod === "EVERY_30_DAYS") return "Monthly billing";
  return "";
}

function CurrentPlan({ entitlement, usage, pricingUrl }) {
  const interval = billingLabel(entitlement);
  return (
    <section className="cf-card cf-stack cf-current-plan" aria-labelledby="current-plan">
      <div className="cf-split">
        <div className="cf-stack-sm">
          <p className="cf-kicker">Current plan</p>
          <h2 id="current-plan">{entitlement.planName || "Choose a plan"}</h2>
          {entitlement.id && (
            <p className="cf-muted">{entitlement.status === "trial" && interval ? interval + ". " : ""}A review uses one slot when it is first finalized.</p>
          )}
        </div>
        {entitlement.id && (
          <span className="cf-badge cf-good">
            {entitlement.developmentOverride ? "Development simulation" : entitlement.status === "trial" ? "Trial" : interval || "Active"}
          </span>
        )}
      </div>
      {entitlement.id ? (
        <>
          {entitlement.trialEndsAt && <p>Trial ends {formatUtc(entitlement.trialEndsAt)}.</p>}
          {entitlement.accessEndsAt && <p>Scheduled access end is {formatUtc(entitlement.accessEndsAt)}.</p>}
          <div className="cf-current-usage">
            <div className="cf-card cf-card-subtle cf-stack-sm">
              <div className="cf-row cf-usage-label">
                <strong className="cf-numeric">{number.format(usage.used)} of {number.format(usage.limit)}</strong>
                <span className="cf-muted">reviews finalized</span>
              </div>
              <progress className="cf-meter" max={usage.limit} value={Math.min(usage.used, usage.limit)} aria-label="Finalized review allowance" />
              <p className="cf-note">{number.format(usage.remaining)} remaining. Allowance renews {formatUtc(entitlement.windowEndsAt)}.</p>
            </div>
            <div className="cf-card cf-card-subtle cf-stack-sm cf-current-limit">
              <strong className="cf-numeric">{number.format(entitlement.maxRows)}</strong>
              <span className="cf-muted">Maximum rows per review</span>
            </div>
          </div>
          {usage.remaining === 0 && <p className="cf-warning">You have used this period’s allowance. Your finalized reviews and approved CSVs are still available.</p>}
        </>
      ) : (
        <p className="cf-muted" role="status">{noPlanMessage[entitlement.status] || noPlanMessage.unavailable}</p>
      )}
      {!pricingUrl && <p className="cf-note">Shopify plan selection is temporarily unavailable.</p>}
    </section>
  );
}

function PlanCard({ plan, interval, current }) {
  const showAnnual = interval === "annual" && Boolean(plan.yearly);
  const price = showAnnual ? plan.yearly : plan.monthly;
  let billing = showAnnual ? "Billed annually" : "Billed monthly";
  if (interval === "annual" && !plan.yearly) billing = "Monthly billing only";
  if (interval === "monthly" && plan.yearly) billing = "Or " + usd.format(plan.yearly) + " billed annually";
  return (
    <article className={"cf-card cf-stack cf-tier-card" + (current ? " cf-tier-current" : "")}>
      <div className="cf-split">
        <h3>{plan.name}</h3>
        {current && <span className="cf-badge cf-good">Current tier</span>}
      </div>
      <div className="cf-stack-sm">
        <p className="cf-tier-price"><strong>{usd.format(price)}</strong><span> / {showAnnual ? "year" : "month"}</span></p>
        <p className="cf-muted">{billing}</p>
      </div>
      <dl className="cf-readout cf-tier-limits">
        <dt>Reviews per month</dt><dd className="cf-numeric">{number.format(plan.maxBatches)}</dd>
        <dt>Rows per review</dt><dd className="cf-numeric">{number.format(plan.maxRows)}</dd>
      </dl>
      <ul className="cf-tier-features">
        {features[plan.id].map((feature) => (
          <li key={feature}><WorkspaceIcon name="check" size={15} /> <span>{feature}</span></li>
        ))}
      </ul>
    </article>
  );
}

export default function Plan() {
  const { entitlement, usage, plans: options, pricingUrl } = useLoaderData();
  const [comparisonInterval, setComparisonInterval] = useState(null);
  const interval = comparisonInterval ?? (entitlement.billingPeriod === "ANNUAL" ? "annual" : "monthly");

  return (
    <s-page heading="Plan" inlineSize="large">
      <div className="cf-flow">
        <WorkspaceHeading
          eyebrow="Subscription"
          title="Plan & usage"
          description="Compare review allowances and the tools available at each tier."
        >
          {pricingUrl && (
            <a className="cf-button cf-primary" href={pricingUrl} target="_top">
              Manage plan in Shopify <WorkspaceIcon name="external" size={15} />
            </a>
          )}
        </WorkspaceHeading>
        <CurrentPlan entitlement={entitlement} usage={usage} pricingUrl={pricingUrl} />
        <section className="cf-stack cf-tier-section" aria-labelledby="plan-options">
          <div className="cf-split">
            <div className="cf-stack-sm">
              <h2 id="plan-options">Compare plans</h2>
              <p className="cf-muted">Prices are in USD. Choose or change your plan in Shopify.</p>
            </div>
            <div className="cf-interval-switch" role="group" aria-label="Compare billing intervals">
              <button type="button" aria-pressed={interval === "monthly"} onClick={() => setComparisonInterval("monthly")}>Monthly</button>
              <button type="button" aria-pressed={interval === "annual"} onClick={() => setComparisonInterval("annual")}>Annual</button>
            </div>
          </div>
          <div className="cf-tier-grid">
            {options.map((plan) => (
              <PlanCard key={plan.id} plan={plan} interval={interval} current={entitlement.id === plan.id} />
            ))}
          </div>
        </section>
      </div>
    </s-page>
  );
}
