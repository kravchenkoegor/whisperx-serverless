"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logOut() {
    setBusy(true);
    await fetch("/api/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logOut}
      disabled={busy}
      className="nav-pill text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-50"
    >
      Log out
    </button>
  );
}
