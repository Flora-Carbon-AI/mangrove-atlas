import type { NextRequest } from "next/server";
import { changeTiles, extentTiles, isGeeDataset } from "@/lib/server/ee";
import { handle, HttpError, requireDataset, requireYear } from "@/lib/server/http";
import { mpcConfig, mpcExtentSources } from "@/lib/server/mpc";
import type { LayersResponse } from "@/lib/types";

const GEE_ATTRIBUTION: Record<string, string> = {
  "gmw-v3": "Global Mangrove Watch v3 (Bunting et al. 2022) via Google Earth Engine",
  "cgmd-30": "Continuous Global Mangrove Dynamics (Zhang et al. 2026, The Mangrove Lab) via Google Earth Engine",
};

/**
 * GET /api/layers?dataset=gmw-v3&year=2020[&mode=change&base=1996]
 * Returns MapLibre raster sources for one year (or a change view between two).
 */
export async function GET(req: NextRequest) {
  return handle(async (): Promise<LayersResponse> => {
    const q = req.nextUrl.searchParams;
    const ds = requireDataset(q);
    const year = requireYear(ds, q.get("year"));
    const mode = q.get("mode") === "change" ? "change" : "extent";

    if (isGeeDataset(ds.id)) {
      if (mode === "change") {
        const base = requireYear(ds, q.get("base"), "base");
        const url = await changeTiles(ds.id, base, year);
        return { dataset: ds.id, year, base, mode, sources: [{ tiles: [url], maxzoom: 14 }], attribution: GEE_ATTRIBUTION[ds.id] };
      }
      const url = await extentTiles(ds.id, year);
      return { dataset: ds.id, year, mode, sources: [{ tiles: [url], maxzoom: 14 }], attribution: GEE_ATTRIBUTION[ds.id] };
    }

    if (mode === "change") throw new HttpError(400, `${ds.name} does not support the change view.`);
    return {
      dataset: ds.id,
      year,
      mode,
      sources: await mpcExtentSources(ds.id, year),
      attribution: mpcConfig(ds.id).attribution,
    };
  }, 1800);
}
