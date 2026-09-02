import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function compactMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatDate(iso: string | null | undefined, pattern = "d MMM yyyy"): string {
  if (!iso) return "-";
  const d = parseISO(iso);
  return isValid(d) ? format(d, pattern) : "-";
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = parseISO(iso);
  if (!isValid(d)) return "-";
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = parseISO(iso);
  if (!isValid(d)) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = parseISO(iso);
  if (!isValid(d)) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return isValid(d) ? format(d, "yyyy-MM-dd") : "";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
