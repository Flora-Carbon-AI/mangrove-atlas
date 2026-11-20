import type { NextRequest } from "next/server";
import { bboxAreaKm2, parseBBox } from "@/lib/geo";
import { handle, HttpError, requireDataset } from "@/lib/server/http";
import { mpcAreaByYear } from "@/lib/server/mpc";
import type { StatsResponse } from "@/lib/types";

/**
 * GET /api/stats?dataset=esa-cci-lc&bbox=w,s,e,n
 * Mangrove area in km² for every year of a Planetary Computer dataset, inside the bbox.
 */
export async function GET(req: NextRequest) {
  return handle(async (): Promise<StatsResponse> => {
    const q = req.nextUrl.searchParams;
    const ds = requireDataset(q);
    if (ds.provider !== "mpc") throw new HttpError(400, `${ds.name} is measured in the browser, not by this API.`);
    const bbox = parseBBox(q.get("bbox"));
    if (!bbox) throw new HttpError(400, "bbox must be west,south,east,north in degrees.");
    const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    if (span > ds.maxStatsSpanDeg) {
      throw new HttpError(
        400,
        `That area is too large to measure with ${ds.name}. Zoom in until the view is under ${ds.maxStatsSpanDeg}° across.`,
      );
    }
    const byYear = await mpcAreaByYear(ds.id, bbox, ds.years);
    return {
      dataset: ds.id,
      bbox,
      regionKm2: bboxAreaKm2(bbox),
      years: ds.years.map((year) => ({ year, areaKm2: byYear[String(year)] ?? 0 })),
    };
  }, 86400);
}
