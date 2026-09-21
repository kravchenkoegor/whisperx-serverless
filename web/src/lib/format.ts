export const COST_PER_SECOND_USD = 0.00019;

export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return "unknown date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown date";
  const text = date.toISOString();
  return `${text.slice(0, 10)} ${text.slice(11, 16)} UTC`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} s`;
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  return hours > 0 ? `${hours} h ${minutes} min ${seconds} s` : `${minutes} min ${seconds} s`;
}

export function formatClock(totalSeconds: number): string {
  const rounded = Math.max(0, Math.floor(totalSeconds));
  const parts = [Math.floor(rounded / 3600), Math.floor((rounded % 3600) / 60), rounded % 60];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatEstimatedCost(totalSeconds: number): string {
  return `$${(totalSeconds * COST_PER_SECOND_USD).toFixed(3)}`;
}

export function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unexpected error";
}
