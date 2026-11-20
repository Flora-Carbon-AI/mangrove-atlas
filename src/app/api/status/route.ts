import type { NextRequest } from "next/server";
import { diagnostics, geeConfigured, initEE } from "@/lib/server/ee";
import { handle } from "@/lib/server/http";
import type { StatusResponse } from "@/lib/types";

/**
 * GET /api/status            → whether Earth Engine is configured and reachable
 * GET /api/status?diagnose=1 → also describes the GEE assets (for maintainers)
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const diagnose = req.nextUrl.searchParams.has("diagnose");
    const status: StatusResponse & { assets?: unknown } = { gee: { configured: geeConfigured(), ok: false } };
    if (!status.gee.configured) return status;
    try {
      await initEE();
      status.gee.ok = true;
      if (diagnose) status.assets = await diagnostics();
    } catch (err) {
      // initEE / diagnostics already log details and return a safe message.
      status.gee.error = err instanceof Error ? err.message : "Earth Engine is unavailable.";
    }
    return status;
  });
}
