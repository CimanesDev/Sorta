import { io } from "next/cache";
import { googleStatus } from "@/lib/gsheet";

const SheetIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2.5" y="2" width="11" height="12" rx="2" />
    <path d="M2.5 6h11M2.5 10h11M7 6v8" />
  </svg>
);

// Header button: opens the Google Sheet when connected, otherwise downloads the Excel file.
export async function SheetButton() {
  await io(); // live setting, never baked into the page at build time
  const g = googleStatus();
  if (g.connected && g.sheetUrl)
    return (
      <a className="ghost-btn" href={g.sheetUrl} target="_blank" rel="noreferrer" title="Open the Google Sheet">
        <SheetIcon />
        Sheet
      </a>
    );
  return <DownloadButton />;
}

export function DownloadButton() {
  return (
    <a className="ghost-btn" href="/api/sheet" title="Download the Excel spreadsheet">
      <SheetIcon />
      Export
    </a>
  );
}
