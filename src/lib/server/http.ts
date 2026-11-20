import "server-only";
import { connection } from "next/server";
import { DATASETS, isDatasetId, type Dataset } from "../datasets";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function requireDataset(params: URLSearchParams): Dataset {
  const id = params.get("dataset");
  if (!isDatasetId(id)) throw new HttpError(400, "Unknown dataset. Use esa-cci-lc or esa-worldcover.");
  return DATASETS[id];
}

export function requireYear(ds: Dataset, value: string | null, name = "year"): number {
  const year = Number(value);
  if (!ds.years.includes(year)) {
    throw new HttpError(400, `${name} must be one of ${ds.years.join(", ")} for ${ds.name}.`);
  }
  return year;
}

/** Wraps a handler so thrown errors become JSON responses. */
export async function handle(fn: () => Promise<unknown>, cacheSeconds = 0): Promise<Response> {
  // Every API route depends on its query string, so opt out of prerendering up front
  // (outside the try, so Next's bail-out signal is never swallowed).
  await connection();
  try {
    const body = await fn();
    return Response.json(body, {
      headers: cacheSeconds
        ? { "cache-control": `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds}` }
        : { "cache-control": "no-store" },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 502;
    const message = err instanceof Error ? err.message : String(err);
    if (status >= 500) console.error("[api]", message);
    return Response.json({ error: message }, { status });
  }
}
