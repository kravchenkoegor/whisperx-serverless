const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_TRACKED_CLIENTS = 5000;

const failuresByClient = new Map<string, number[]>();

function recentFailures(client: string, now: number): number[] {
  return (failuresByClient.get(client) ?? []).filter((at) => now - at < WINDOW_MS);
}

function pruneExpired(now: number): void {
  for (const [client, failures] of failuresByClient) {
    if (failures.every((at) => now - at >= WINDOW_MS)) failuresByClient.delete(client);
  }
}

export function retryAfterSeconds(client: string, now: number = Date.now()): number {
  const failures = recentFailures(client, now);
  if (failures.length < MAX_FAILURES) return 0;
  return Math.max(1, Math.ceil((failures[0] + WINDOW_MS - now) / 1000));
}

export function recordFailure(client: string, now: number = Date.now()): void {
  if (failuresByClient.size >= MAX_TRACKED_CLIENTS) pruneExpired(now);
  if (failuresByClient.size >= MAX_TRACKED_CLIENTS) failuresByClient.clear();
  failuresByClient.set(client, [...recentFailures(client, now), now]);
}

export function clearFailures(client: string): void {
  failuresByClient.delete(client);
}
