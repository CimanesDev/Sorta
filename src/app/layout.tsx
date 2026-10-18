import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { Suspense } from "react";
import { AiBadge } from "@/components/AiBadge";
import { MainNav } from "@/components/MainNav";
import { Nav } from "@/components/NavLinks";
import { DownloadButton, SheetButton } from "@/components/SheetButton";
import { ThemeToggle, themeScript } from "@/components/ThemeToggle";
import { ToothMark } from "@/components/ToothMark";
import "./globals.css";

// Atkinson Hyperlegible (Braille Institute): built for legibility. Bundled locally.
const sans = localFont({
  src: [
    { path: "./fonts/ahn-400.woff2", weight: "400" },
    { path: "./fonts/ahn-500.woff2", weight: "500" },
    { path: "./fonts/ahn-700.woff2", weight: "700" },
  ],
  variable: "--font-sans",
});
const mono = localFont({
  src: [
    { path: "./fonts/ahm-400.woff2", weight: "400" },
    { path: "./fonts/ahm-700.woff2", weight: "700" },
  ],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: { default: "Sorta", template: "%s · Sorta" },
  description: "Automatically sort Facebook posts of private dental clinics into content categories.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <header className="top">
          <Link href="/" className="brand" aria-label="Sorta home">
            <ToothMark />
            <span className="brand-name">Sorta</span>
          </Link>
          <Suspense fallback={<Nav />}>
            <MainNav />
          </Suspense>
          <div className="top-right">
            <Suspense fallback={<span className="ai-status"><i />AI</span>}>
              <AiBadge />
            </Suspense>
            <Suspense fallback={<DownloadButton />}>
              <SheetButton />
            </Suspense>
            <ThemeToggle />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
