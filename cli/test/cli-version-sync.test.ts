import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// sync.ts hardcodes CLI_VERSION (sent as the X-Tokenboard-CLI header) and only a comment tied it to
// package.json — so it silently rotted to "0.0.1" while the package shipped through 0.1.6, making
// every sync report a version that was never published. This pins the two together.
//
// It reads sync.ts as TEXT rather than importing CLI_VERSION because the constant isn't exported (a
// module-private detail; exporting it just for a test would be a "just in case" export). The regex is
// anchored to the exact declaration, so a rename fails loudly here instead of silently passing.
const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = dirname(here);

test("CLI_VERSION in sync.ts matches package.json version", () => {
  const pkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")) as { version?: string };
  const source = readFileSync(join(cliRoot, "src", "commands", "sync.ts"), "utf8");

  const match = source.match(/^const CLI_VERSION = "([^"]+)";/m);
  assert.ok(match, "could not find `const CLI_VERSION = \"...\";` in sync.ts — was it renamed?");
  assert.ok(pkg.version, "package.json has no version field");

  assert.equal(
    match[1],
    pkg.version,
    `CLI_VERSION (${match[1]}) != package.json version (${pkg.version}) — bump BOTH when releasing.`,
  );
});
