import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader variant="public" />
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </>
  );
}
