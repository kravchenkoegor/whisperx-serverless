import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { NavLink } from "./nav-link";

type SiteHeaderProps = { variant: "app" | "public" };

export function SiteHeader({ variant }: SiteHeaderProps) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <Link href={variant === "app" ? "/" : "/demo"} className="mr-2 text-sm font-semibold tracking-tight">
          Whisper control panel
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-wrap items-center gap-1">
          {variant === "app" && (
            <>
              <NavLink href="/" label="Recordings" matchPrefixes={["/r/"]} />
              <NavLink href="/new" label="New" />
              <NavLink href="/prompts" label="Prompts" />
            </>
          )}
          <NavLink href="/demo" label="Demo" />
          <span className="ml-auto">
            {variant === "app" ? <LogoutButton /> : <NavLink href="/login" label="Log in" />}
          </span>
        </nav>
      </div>
    </header>
  );
}
