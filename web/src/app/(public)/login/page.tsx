import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { safeNextPath } from "@/lib/session";

export const metadata: Metadata = { title: "Log in" };

type LoginPageProps = { searchParams: Promise<{ next?: string | string[] }> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(typeof next === "string" ? next : null)} />;
}
