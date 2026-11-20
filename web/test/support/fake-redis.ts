// In-memory stand-in for the Upstash client, covering only the sorted-set commands the leaderboard
// touches. Ordering mirrors Redis: score, then member BYTE-wise (ZREVRANGE reverses both), so tests
// exercise the same tie order production sees.
type Zset = Map<string, number>;

function byteCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

export class FakeRedis {
  readonly zsets = new Map<string, Zset>();
  failOn: string | null = null; // command name that should reject, to exercise failure paths

  private check(cmd: string): void {
    if (this.failOn === cmd) throw new Error(`fake redis: ${cmd} failed`);
  }

  private ascending(key: string): Array<[string, number]> {
    return [...(this.zsets.get(key) ?? [])].sort((x, y) => x[1] - y[1] || byteCompare(x[0], y[0]));
  }

  seed(key: string, members: Array<[string, number]>): void {
    this.zsets.set(key, new Map(members));
  }

  members(key: string): string[] {
    return [...(this.zsets.get(key)?.keys() ?? [])];
  }

  async zrange(key: string, start: number, stop: number, opts: { rev?: boolean; withScores?: boolean }) {
    this.check("zrange");
    const rows = this.ascending(key);
    if (opts.rev) rows.reverse();
    return rows.slice(start, stop + 1).flatMap(([m, s]) => (opts.withScores ? [m, s] : [m]));
  }

  async zcard(key: string): Promise<number> {
    this.check("zcard");
    return this.zsets.get(key)?.size ?? 0;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    this.check("zrem");
    const z = this.zsets.get(key);
    if (!z) return 0;
    let n = 0;
    for (const m of members) if (z.delete(m)) n++;
    if (z.size === 0) this.zsets.delete(key);
    return n;
  }

  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const p = {
      zrem: (key: string, ...members: string[]) => (ops.push(() => this.zrem(key, ...members)), p),
      zrevrank: (key: string, member: string) =>
        (ops.push(async () => {
          const idx = this.ascending(key).reverse().findIndex(([m]) => m === member);
          return idx === -1 ? null : idx;
        }),
        p),
      zscore: (key: string, member: string) => (ops.push(async () => this.zsets.get(key)?.get(member) ?? null), p),
      zcard: (key: string) => (ops.push(() => this.zcard(key)), p),
      exec: async () => {
        const out: unknown[] = [];
        for (const op of ops) out.push(await op());
        return out;
      },
    };
    return p;
  }
}
