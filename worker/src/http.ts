export async function readJson<T>(context: { req: { json: () => Promise<unknown> } }): Promise<T | null> {
  try {
    return (await context.req.json()) as T;
  } catch {
    return null;
  }
}

/** Parst eine positive Ganzzahl aus einem Pfad-/Query-Parameter; sonst null (statt NaN). */
export function parseId(raw: string | undefined | null): number | null {
  if (raw == null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
