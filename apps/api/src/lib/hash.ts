import { createHash } from "node:crypto";

export function sha256(input: string | object): string {
  const s = typeof input === "string" ? input : stableStringify(input);
  return createHash("sha256").update(s).digest("hex");
}

/** Deterministic JSON (sorted keys) so equal objects hash equally regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}
