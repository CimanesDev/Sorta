import type { Metadata } from "next";
import { io } from "next/cache";
import { Suspense } from "react";
import { GoogleSetup } from "@/components/GoogleSetup";
import { appsScript } from "@/lib/appsScript";
import { googleStatus } from "@/lib/gsheet";
import { readSettings } from "@/lib/settings";
import { SHEET_PATH } from "@/lib/sheet";

export const metadata: Metadata = { title: "Google Sheets" };

export default function SheetsPage() {
  return (
    <>
      <header className="intro">
        <h1>Google Sheets</h1>
        <p>
          Keep a Google Sheet updated automatically with every post&apos;s category. Set it up once; after that it updates
          by itself.
        </p>
      </header>
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <Sheets />
      </Suspense>
    </>
  );
}

async function Sheets() {
  await io();
  const s = readSettings();
  return <GoogleSetup status={googleStatus()} script={appsScript(s.googleToken)} excelPath={SHEET_PATH} />;
}
