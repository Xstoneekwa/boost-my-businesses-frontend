// Browser-safe bridge for shared projection modules. The Node observer is
// registered only by /profiles/live; client bundles never import async_hooks.
type Attribute = number | string | boolean | null;
type Observer = {
  step<T>(operation: string, fn: () => T | PromiseLike<T>, attributes?: Record<string, Attribute>): Promise<T>;
  metric(name: string, value: Attribute): void;
  fallback(reason: string): void;
  fetch: typeof fetch;
};
const key = Symbol.for("profiles_live_causal_v2_observer");
const root = globalThis as typeof globalThis & { [key]?: Observer };
export function registerProfilesLiveObserver(observer: Observer) { root[key] = observer; }
export async function traceStep<T>(operation: string, fn: () => T | PromiseLike<T>, attributes?: Record<string, Attribute>): Promise<T> {
  if (root[key]) return root[key]!.step(operation, fn, attributes);
  return await fn();
}
export function traceMetric(name: string, value: Attribute) { root[key]?.metric(name, value); }
export function traceFallback(reason: string) { root[key]?.fallback(reason); }
export const causalFetch: typeof fetch = (input, init) => root[key]?.fetch(input, init) ?? fetch(input, init);
