import { readAuthFile } from "../config/auth-store.js";
import { safeLine } from "../render/sanitize.js";

const out = (line: string) => process.stdout.write(`${line}\n`);

export async function runWhoami(): Promise<void> {
  const auth = await readAuthFile();
  if (!auth) throw new Error("not signed in — run `tokenboard claim` first.");
  out(safeLine`  tokenboard whoami — @${auth.handle}`);
  out(safeLine`  user id:  ${auth.userId}`);
  out(safeLine`  claimed:  ${auth.createdAt}`);
}
