"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLinkProps = { href: string; label: string; matchPrefixes?: string[] };

function isActive(pathname: string, href: string, matchPrefixes: string[]): boolean {
  if (pathname === href) return true;
  return matchPrefixes.some((prefix) => pathname.startsWith(prefix));
}

export function NavLink({ href, label, matchPrefixes = [] }: NavLinkProps) {
  const active = isActive(usePathname(), href, matchPrefixes);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-accent-soft text-accent" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
      }`}
    >
      {label}
    </Link>
  );
}
