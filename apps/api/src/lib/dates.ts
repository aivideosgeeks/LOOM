export const DAY_MS = 86_400_000;

export function daysBetween(from: Date | string | null | undefined, to: Date = new Date()): number {
  if (!from) return Number.POSITIVE_INFINITY;
  const f = typeof from === "string" ? new Date(from) : from;
  return Math.max(0, (to.getTime() - f.getTime()) / DAY_MS);
}

export function daysAgo(n: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - n * DAY_MS);
}

export function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
