import type { NextRequest } from "next/server";
import { isGeeDataset, pointHistory } from "@/lib/server/ee";
import { handle, HttpError, requireDataset } from "@/lib/server/http";
import { mpcPointHistory } from "@/lib/server/mpc";
import type { PointResponse } from "@/lib/types";

/**
 * GET /api/point?dataset=gmw-v3&lon=89.2&lat=21.9
 * Year-by-year mangrove presence at a single location.
 */
export async function GET(req: NextRequest) {
  return handle(async (): Promise<PointResponse> => {
    const q = req.nextUrl.searchParams;
    const ds = requireDataset(q);
    const lon = Number(q.get("lon"));
    const lat = Number(q.get("lat"));
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new HttpError(400, "lon and lat must be valid coordinates.");
    }
    const raw = isGeeDataset(ds.id)
      ? await pointHistory(ds.id, lon, lat, ds.years)
      : await mpcPointHistory(ds.id, lon, lat, ds.years);
    return {
      dataset: ds.id,
      lon,
      lat,
      years: ds.years.map((year) => {
        const v = raw[String(year)];
        return { year, present: v === null || v === undefined ? null : v > 0 };
      }),
    };
  }, 86400);
}
