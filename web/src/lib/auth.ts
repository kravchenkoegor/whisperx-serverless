import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, isValidSessionToken } from "./session";

export async function hasSession(): Promise<boolean> {
  const store = await cookies();
  return isValidSessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function requirePageSession(currentPath: string): Promise<void> {
  if (await hasSession()) return;
  redirect(`/login?next=${encodeURIComponent(currentPath)}`);
}
