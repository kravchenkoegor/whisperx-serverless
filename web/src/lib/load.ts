import { describeError } from "./format";

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

export async function load<T>(read: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    console.error(error);
    return { ok: false, error: describeError(error) };
  }
}
