import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader variant="app" />
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </>
  );
}
