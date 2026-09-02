export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: unknown = null,
    /** Parsed response body, for endpoints that return a structured rejection (e.g. /api/ai/ask). */
    public body: unknown = null,
  ) {
    super(message);
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  json?: unknown;
  body?: BodyInit | null;
}

/** Thin fetch wrapper. Requests go to the Next server, which proxies /api/* to Express (same-origin cookies). */
export async function api<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : (rest.body ?? undefined),
    credentials: "same-origin",
    cache: "no-store",
  });
  const text = await res.text();
  let data: { error?: string; details?: unknown } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, data?.error ?? (data as { reason?: string } | null)?.reason ?? res.statusText, data?.details ?? null, data);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (Array.isArray(err.details) && err.details.length) {
      const first = err.details[0] as { path?: string; message?: string };
      return `${err.message}: ${first.path ? `${first.path} ` : ""}${first.message ?? ""}`.trim();
    }
    return err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
