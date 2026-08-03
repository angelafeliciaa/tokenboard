import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { readLastRun } from "../src/commands/service.js";

test("readLastRun returns null when the log does not exist", async () => {
  assert.equal(await readLastRun(join(tmpdir(), "tb-no-such-log-xyz.log")), null);
});

test("readLastRun returns the last non-empty line from a large log without reading it all", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tb-logtail-"));
  try {
    const path = join(dir, "service.log");
    const filler = "old noisy line that repeats\n".repeat(200_000); // ~5MB, far past the 64KB tail
    await writeFile(path, filler + "tokenboard sync — uploaded 3 records\n\n");
    const last = await readLastRun(path);
    assert.ok(last);
    assert.equal(last.line, "tokenboard sync — uploaded 3 records");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
