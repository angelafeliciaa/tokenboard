# Third-Party Notices

tokenboard is MIT-licensed (see `LICENSE`). It builds on the following
open-source projects, with gratitude:

## ccusage

tokenboard's CLI shells out to [`ccusage`](https://github.com/ryoppippi/ccusage)
to parse local usage logs for the long tail of agentic-coding tools (Codex,
opencode, grok, droid, and others). ccusage is MIT-licensed.

- Project: https://github.com/ryoppippi/ccusage
- Copyright (c) ryoppippi
- License: MIT

## LiteLLM model pricing data

tokenboard vendors a pinned snapshot of LiteLLM's model pricing data
(`model_prices_and_context_window.json`) — used server-side for authoritative
cost and bundled into the CLI for the offline local-preview estimate.

- Project: https://github.com/BerriAI/litellm
- License: MIT
- Pinned commit: `fb0077053885f95ab3d4f302aec15024733705e2`
  (sha256 `afbb50753937db89016b7e0855d79a1ba97ca5dc22c5f6c0a2204a9a3e16becc`)
- Provenance recorded in `cli/src/cost/provenance.json`

---

This file lists projects whose licenses request attribution or whose data we
vendor. It is informational and does not modify tokenboard's own MIT license.
