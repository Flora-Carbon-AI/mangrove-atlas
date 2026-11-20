import type { NextRequest } from "next/server";
import { geeConfigured, gmwDiagnostics, initEE } from "@/lib/server/ee";
import { handle } from "@/lib/server/http";
import type { StatusResponse } from "@/lib/types";

/**
 * GET /api/status            → whether Earth Engine is configured and reachable
 * GET /api/status?diagnose=1 → also lists what the GMW v3 collection contains
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const diagnose = req.nextUrl.searchParams.has("diagnose");
    const status: StatusResponse & { gmw?: unknown } = { gee: { configured: geeConfigured(), ok: false } };
    if (!status.gee.configured) return status;
    try {
      await initEE();
      status.gee.ok = true;
      if (diagnose) status.gmw = await gmwDiagnostics();
    } catch (err) {
      status.gee.error = err instanceof Error ? err.message : String(err);
    }
    return status;
  });
}
