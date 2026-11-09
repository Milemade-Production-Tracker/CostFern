import { Link, redirect } from "react-router";
import styles from "./styles.module.css";

export const loader = ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop") && url.searchParams.get("host")) {
    return redirect(`/app${url.search}`);
  }

  return null;
};

export default function App() {
  return (
    <main className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>CostFern</h1>
        <p className={styles.text}>
          Review supplier cost changes before approving them.
        </p>
        <p className={styles.access}>Open CostFern from Apps in your <a href="https://admin.shopify.com/">Shopify admin</a>.</p>
        <ul className={styles.list}>
          <li>
            <strong>Compare quotes.</strong> See which unit costs changed between two supplier files.
          </li>
          <li>
            <strong>Match Shopify variants.</strong> Confirm the right variant when a supplier SKU needs review.
          </li>
          <li>
            <strong>Export approvals.</strong> Keep approved costs and their source versions together.
          </li>
        </ul>
        <footer><Link to="/privacy">Privacy Policy</Link></footer>
      </div>
    </main>
  );
}
