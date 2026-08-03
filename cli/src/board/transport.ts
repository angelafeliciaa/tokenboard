import {
  boardResponseSchema,
  type BoardResponse,
  type BoardWindow,
  type BoardMetric,
  type BoardFormat,
} from "@tokenboard/contracts";

const REQUEST_TIMEOUT_MS = 15_000;

export interface BoardParams {
  community: string;
  window: BoardWindow;
  metric: BoardMetric;
  format: BoardFormat;
  me?: string;
  limit?: number;
}

export async function fetchBoard(base: string, params: BoardParams): Promise<BoardResponse> {
  const url = new URL(`${base}/api/v1/board`);
  url.searchParams.set("community", params.community);
  url.searchParams.set("window", params.window);
  url.searchParams.set("metric", params.metric);
  url.searchParams.set("format", params.format);
  if (params.limit !== undefined) url.searchParams.set("limit", String(params.limit));
  if (params.me) url.searchParams.set("me", params.me);

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error("that board is private — you must be a member to view it.");
    if (res.status === 404) throw new Error("no board found for that community.");
    throw new Error(`board request failed (HTTP ${res.status}).`);
  }
  return boardResponseSchema.parse(await res.json());
}
