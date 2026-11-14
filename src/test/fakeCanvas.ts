/** Canvas 2D への命令 (メソッド呼び出し・プロパティ代入) を記録する偽コンテキスト */
export interface RecordedCall {
  op: string;
  args: unknown[];
}

export type RecordingContext = CanvasRenderingContext2D & { calls: RecordedCall[] };

export function createRecordingContext(): RecordingContext {
  const calls: RecordedCall[] = [];
  const props: Record<string | symbol, unknown> = {};
  return new Proxy(props, {
    get(target, key) {
      if (key === "calls") return calls;
      if (key in target) return target[key];
      if (key === "then") return undefined;
      return (...args: unknown[]) => {
        calls.push({ op: String(key), args });
      };
    },
    set(target, key, value) {
      calls.push({ op: `set:${String(key)}`, args: [value] });
      target[key] = value;
      return true;
    },
  }) as unknown as RecordingContext;
}

/** 記録の中から特定の命令だけを取り出す */
export const callsOf = (ctx: RecordingContext, op: string) =>
  ctx.calls.filter((c) => c.op === op);

/** HTMLCanvasElement.getContext を、要素ごとに同じ偽コンテキストを返すよう差し替える */
export function installFakeCanvas(): void {
  const contexts = new WeakMap<HTMLCanvasElement, RecordingContext>();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = createRecordingContext();
      contexts.set(this, ctx);
    }
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
