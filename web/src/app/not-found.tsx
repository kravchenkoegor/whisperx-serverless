import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 text-center">
      <h1>Page not found</h1>
      <p className="mt-2 text-fg-muted">The page or recording you asked for does not exist.</p>
      <Link href="/" className="link mt-4 inline-block">
        Back to recordings
      </Link>
    </main>
  );
}
