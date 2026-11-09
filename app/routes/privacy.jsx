import { Link } from "react-router";
import { WorkspaceHeading } from "../components/workspace-ui.jsx";
import "../styles/costfern.css";

const privacyEmail = "whittlerdarleen5cngca@hotmail.com";

export function meta() {
  return [
    { title: "Privacy Policy | CostFern" },
    { name: "description", content: "How CostFern handles information for its Shopify supplier quote review app." },
  ];
}

export default function PrivacyPolicy() {
  return (
    <div className="cf-workspace">
      <main className="cf-flow" style={{ maxWidth: "52rem", padding: "clamp(20px, 5vw, 56px)", fontSize: "15px" }}>
        <WorkspaceHeading eyebrow="CostFern" title="Privacy Policy" description="Effective November 9, 2026" />
        <article className="cf-card cf-stack">
          <p>CostFern operates the CostFern app for Shopify merchants. This policy describes the information we use when merchants and their staff review supplier quotes in Shopify Admin.</p>

          <section className="cf-stack-sm">
            <h2>Information we process</h2>
            <ul>
              <li>From Shopify, we receive shop and session information to authenticate access, staff identifiers for the decision history, and subscription status to apply plan limits. Shopify handles subscription payments.</li>
              <li>We read product and variant identifiers, titles, SKUs, and images to match quote lines to the merchant&apos;s catalog. This catalog access is read-only. The app runs in Shopify Admin and limits collection to this merchant workflow.</li>
              <li>Merchants provide supplier details, quote CSVs, and review decisions and notes. CostFern stores parsed quote lines, source filenames and file fingerprints, and the decision history. The original CSV uploads are discarded after processing. Include only information needed to review supplier costs.</li>
              <li>We use technical request and error information to operate and troubleshoot the service. If you contact us about privacy, we use your contact details and message to respond.</li>
            </ul>
          </section>

          <section className="cf-stack-sm">
            <h2>How we use and share information</h2>
            <p>We use information to match quotes, record approvals, generate exports, administer plan access and allowances, secure the service, and handle privacy requests. Shopify provides authentication, catalog access and billing. DigitalOcean hosts the application and its database. These providers may process information in the regions where they operate. We may also disclose information when legally required.</p>
          </section>

          <section className="cf-stack-sm">
            <h2>Retention and deletion</h2>
            <p>We retain supplier records, review history and usage while the app is installed so merchants can continue reviews and download finalized results. On receipt of Shopify&apos;s uninstall notification, we remove the sessions associated with that installation. When Shopify sends a verified, applicable shop erasure request, we delete the stored shop records.</p>
          </section>

          <section className="cf-stack-sm">
            <h2>Privacy requests</h2>
            <p>To ask about access, correction or deletion of your information, email CostFern at <a className="cf-break" href={`mailto:${privacyEmail}`}>{privacyEmail}</a>. Include your Shopify store domain so we can identify the account and verify the request. Shoppers should contact the merchant about information held by their store.</p>
          </section>
        </article>
        <p><Link to="/">Back to CostFern</Link></p>
      </main>
    </div>
  );
}
