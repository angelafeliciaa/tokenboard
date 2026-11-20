import provenance from "./provenance.json" with { type: "json" };

// The pinned LiteLLM table identity. Hand-mirrored as plain string constants so consumers (the web
// route, the startup audit) never depend on a JSON import attribute resolving through transpilePackages.
// The assert below pins these to provenance.json at module load (a test also covers it), so they can
// never silently drift from the artifact the vendor script writes.
export const PRICE_TABLE_VERSION = "litellm-2026-11-20";
export const PRICE_TABLE_COMMIT_SHA = "fb0077053885f95ab3d4f302aec15024733705e2";
export const PRICE_TABLE_UPSTREAM_SHA256 =
  "afbb50753937db89016b7e0855d79a1ba97ca5dc22c5f6c0a2204a9a3e16becc";

if (
  provenance.priceTableVersion !== PRICE_TABLE_VERSION ||
  provenance.commitSha !== PRICE_TABLE_COMMIT_SHA ||
  provenance.upstreamSha256 !== PRICE_TABLE_UPSTREAM_SHA256
) {
  throw new Error(
    "provenance-version.ts constants drifted from provenance.json — update the constants after a price-table bump.",
  );
}
