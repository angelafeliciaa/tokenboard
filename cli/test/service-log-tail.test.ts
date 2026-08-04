import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { readLastRun, tailRange } from "../src/commands/service.js";

const ELLIPSIS = String.fromCharCode(0x2026);
const NUL = String.fromCharCode(0);
const TAIL_BYTES = 64 * 1024;

test("tailRange never reads more than the bounded window and ends at EOF", () => {
  assert.deepEqual(tailRange(10), { start: 0, length: 10 });
  const big = tailRange(5 * 1024 * 1024);
  assert.equal(big.length, TAIL_BYTES);
  assert.equal(big.start, 5 * 1024 * 1024 - TAIL_BYTES);
});

test("readLastRun returns null when the log does not exist", async () => {
  assert.equal(await readLastRun(join(tmpdir(), "tb-no-such-log-xyz.log")), null);
});

test("readLastRun returns the last non-empty line from a large log without reading it all", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tb-logtail-"));
  try {
    const path = join(dir, "service.log");
    const filler = "old noisy line that repeats\n".repeat(200_000);
    await writeFile(path, filler + "tokenboard sync — uploaded 3 records\n\n");
    const last = await readLastRun(path);
    assert.ok(last);
    assert.equal(last.line, "tokenboard sync — uploaded 3 records");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readLastRun marks a final line longer than the tail window as truncated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tb-logtail-long-"));
  try {
    const path = join(dir, "service.log");
    await writeFile(path, "x".repeat(100 * 1024));
    const last = await readLastRun(path);
    assert.ok(last);
    assert.ok(last.line.startsWith(ELLIPSIS));
    assert.ok(last.line.length > 60_000);
    assert.ok(!last.line.includes(NUL));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readLastRun marks truncation even when the oversized line has a trailing newline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tb-logtail-nl-"));
  try {
    const path = join(dir, "service.log");
    await writeFile(path, "x".repeat(100 * 1024) + "\n");
    const last = await readLastRun(path);
    assert.ok(last);
    assert.ok(last.line.startsWith(ELLIPSIS));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
