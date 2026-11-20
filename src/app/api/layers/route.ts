import type { NextRequest } from "next/server";
import { handle, HttpError, requireDataset, requireYear } from "@/lib/server/http";
import { mpcConfig, mpcExtentSources } from "@/lib/server/mpc";
import type { LayersResponse } from "@/lib/types";

/**
 * GET /api/layers?dataset=esa-cci-lc&year=2010
 * MapLibre raster sources for a Planetary Computer dataset and year.
 * (Global Mangrove Watch is decoded in the browser and doesn't use this route.)
 */
export async function GET(req: NextRequest) {
  return handle(async (): Promise<LayersResponse> => {
    const q = req.nextUrl.searchParams;
    const ds = requireDataset(q);
    if (ds.provider !== "mpc") throw new HttpError(400, `${ds.name} is served as static tiles, not by this API.`);
    const year = requireYear(ds, q.get("year"));
    return {
      dataset: ds.id,
      year,
      mode: "extent",
      sources: await mpcExtentSources(ds.id, year),
      attribution: mpcConfig(ds.id).attribution,
    };
  }, 1800);
}
