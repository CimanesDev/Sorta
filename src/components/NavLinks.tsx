"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Posts" },
  { href: "/review", label: "Review" },
  { href: "/results", label: "Results" },
  { href: "/sheets", label: "Google Sheets" },
];

export function NavLinks({ reviewCount }: { reviewCount?: number }) {
  return <Nav path={usePathname()} reviewCount={reviewCount} />;
}

// Rendered in the static shell until the URL is known.
export function Nav({ path, reviewCount }: { path?: string; reviewCount?: number }) {
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => {
        const active = !!path && (l.href === "/" ? path === "/" || path.startsWith("/posts") : path.startsWith(l.href));
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            {l.label}
            {l.href === "/review" && !!reviewCount && (
              <span className="count" aria-label={`${reviewCount} waiting`}>
                {reviewCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
