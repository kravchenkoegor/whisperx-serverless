export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function errorMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return `Request failed with status ${response.status}`;
}

function redirectToLogin(): void {
  const loginUrl = new URL("/login", window.location.origin);
  loginUrl.searchParams.set("next", window.location.pathname);
  window.location.assign(loginUrl);
}

export async function apiRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 401 && !path.startsWith("/api/login")) redirectToLogin();
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
  return (await response.json()) as T;
}

export async function apiText(path: string): Promise<string> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, await errorMessage(response));
  return response.text();
}

export function fileUrl(key: string, download = false): string {
  const query = new URLSearchParams({ key });
  if (download) query.set("download", "1");
  return `/api/files?${query.toString()}`;
}

export function fileTextUrl(key: string): string {
  return `/api/files/text?${new URLSearchParams({ key }).toString()}`;
}
