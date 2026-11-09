/* eslint-disable react/prop-types */
const glyphs = {
  alert: "M10 4 3 17a2 2 0 0 0 2 3h14a2 2 0 0 0 2-3L14 4a2 2 0 0 0-4 0ZM12 9v4m0 3h.01",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  box: "m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10M7 5l9 4",
  card: "M3 6h18v12H3V6Zm0 4h18M7 14h4",
  check: "m5 12 4 4L19 6",
  chevron: "m9 6 6 6-6 6",
  clock: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-4v4l3 2",
  close: "m6 6 12 12M18 6 6 18",
  compare: "M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4",
  download: "M12 4v12m-4-4 4 4 4-4M5 17v3h14v-3",
  edit: "m14 6 4 4M5 19l4-.8L20 7l-3-3L6 15l-1 4Z",
  external: "M13 4h7v7m0-7-9 9m7 0v7H4V6h7",
  file: "M6 3h8l4 4v14H6V3Zm8 0v5h4M9 13h6m-6 4h6",
  history: "M3 12a9 9 0 1 1 2.6 6.4M3 5v7h7m2-5v5l4 2",
  layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  leaf: "M5 19C5 11 11 5 20 4c-1 9-6 15-13 14M5 20c3-5 7-8 11-10m-6 3L9 8m3 4 5 1",
  lock: "M5 10h14v11H5V10Zm3 0V7a4 4 0 0 1 8 0v3m-4 4v3",
  minus: "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8 12h8",
  plus: "M12 5v14M5 12h14",
  search: "M16 10.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0ZM15 15l4 4",
  upload: "M12 16V4m-4 4 4-4 4 4M5 15v5h14v-5",
};

export function WorkspaceIcon({ name, size = 16 }) {
  return (
    <svg className="cf-icon" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <path d={glyphs[name] ?? glyphs.box} />
    </svg>
  );
}

export function WorkspaceHeading({ eyebrow, title, description, children }) {
  return (
    <header className="cf-page-head">
      <div className="cf-page-head-copy">
        <p className="cf-kicker">{eyebrow}</p>
        <h2 className="cf-display">{title}</h2>
        {description && <p className="cf-page-lede">{description}</p>}
      </div>
      {children && <div className="cf-page-actions cf-row">{children}</div>}
    </header>
  );
}
