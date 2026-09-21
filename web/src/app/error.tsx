"use client";

type ErrorPageProps = { error: Error & { digest?: string }; reset: () => void };

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <div role="alert" className="notice notice-danger">
        <p className="font-semibold">Something went wrong</p>
        <p className="mt-1 break-words">{error.message || "Unexpected error"}</p>
      </div>
      <button type="button" className="btn mt-4" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
