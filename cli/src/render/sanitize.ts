function isDisplaySafe(code: number): boolean {
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false;
  if (code === 0x061c) return false;
  if (code >= 0x200b && code <= 0x200f) return false;
  if (code === 0x2028 || code === 0x2029) return false;
  if (code >= 0x202a && code <= 0x202e) return false;
  if (code >= 0x2060 && code <= 0x2064) return false;
  if (code >= 0x2066 && code <= 0x2069) return false;
  if (code === 0xfeff) return false;
  return true;
}

export function sanitizeTerminalText(value: string): string {
  let out = "";
  for (const ch of value) {
    if (isDisplaySafe(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out;
}

export function safeLine(strings: TemplateStringsArray, ...values: unknown[]): string {
  let result = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    result += sanitizeTerminalText(String(values[i])) + (strings[i + 1] ?? "");
  }
  return result;
}
