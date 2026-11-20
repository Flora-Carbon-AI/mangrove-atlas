import type { NextRequest } from "next/server";
import { gmwChangeTiles, gmwExtentTiles } from "@/lib/server/ee";
import { handle, HttpError, requireDataset, requireYear } from "@/lib/server/http";
import { mpcConfig, mpcExtentSources } from "@/lib/server/mpc";
import type { LayersResponse } from "@/lib/types";

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

    if (mode === "change") {
      if (!ds.supportsChange) throw new HttpError(400, `${ds.name} does not support the change view.`);
      const base = requireYear(ds, q.get("base"), "base");
      const url = await gmwChangeTiles(base, year);
      return {
        dataset: ds.id,
        year,
        base,
        mode,
        sources: [{ tiles: [url], maxzoom: 14 }],
        attribution: "Global Mangrove Watch v3 (Bunting et al. 2022) via Google Earth Engine",
      };
    }

    if (ds.provider === "gee") {
      const url = await gmwExtentTiles(year);
      return {
        dataset: ds.id,
        year,
        mode,
        sources: [{ tiles: [url], maxzoom: 14 }],
        attribution: "Global Mangrove Watch v3 (Bunting et al. 2022) via Google Earth Engine",
      };
    }

    return {
      dataset: ds.id,
      year,
      mode,
      sources: await mpcExtentSources(ds.id, year),
      attribution: mpcConfig(ds.id).attribution,
    };
  }, 1800);
}
