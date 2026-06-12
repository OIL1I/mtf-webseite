export async function readJson<T>(context: { req: { json: () => Promise<unknown> } }): Promise<T | null> {
  try {
    return (await context.req.json()) as T;
  } catch {
    return null;
  }
}
