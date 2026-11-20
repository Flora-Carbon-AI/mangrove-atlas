import type { Map as MLMap, MapOptions } from "maplibre-gl";
import type { LayersResponse } from "@/lib/types";

/** Esri World Imagery, slightly muted so mangrove overlays stay legible. */
export const BASE_STYLE: MapOptions["style"] = {
  version: 8,
  sources: {
    imagery: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    labels: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 18,
    },
  },
  layers: [
    {
      id: "imagery",
      type: "raster",
      source: "imagery",
      paint: { "raster-saturation": -0.55, "raster-brightness-max": 0.72, "raster-contrast": 0.08 },
    },
    { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.85 } },
  ],
};

const PREFIX = "mg-";
let generation = 0;
const latest = new WeakMap<MLMap, string>();

/** Removes overlay layers and sources from every generation except `keep`. */
function removeOverlays(map: MLMap, keep: string | null) {
  const style = map.getStyle();
  for (const layer of style.layers ?? []) {
    if (layer.id.startsWith(PREFIX) && (keep === null || !layer.id.startsWith(keep))) map.removeLayer(layer.id);
  }
  for (const id of Object.keys(style.sources ?? {})) {
    if (id.startsWith(PREFIX) && (keep === null || !id.startsWith(keep))) map.removeSource(id);
  }
}

/**
 * Replaces the mangrove overlay on a map with the sources in `data`.
 * The new layers go in on top first and the old ones are removed once the
 * new tiles have drawn, so stepping through years doesn't flash empty.
 */
export function applyOverlay(map: MLMap, data: LayersResponse | null, opacity: number) {
  if (!data) {
    latest.delete(map);
    removeOverlays(map, null);
    return;
  }
  const gen = `${PREFIX}${++generation}-`;
  latest.set(map, gen);
  const swap = () => {
    // Only the newest generation cleans up; older swaps would delete it.
    if (latest.get(map) === gen && map.getStyle()) removeOverlays(map, gen);
  };
  map.once("idle", swap);
  setTimeout(swap, 5000); // in case tiles never settle (e.g. the user keeps panning)
  data.sources.forEach((src, i) => {
    const id = `${gen}${i}`;
    map.addSource(id, {
      type: "raster",
      tiles: src.tiles,
      tileSize: 256,
      ...(src.bounds ? { bounds: src.bounds } : {}),
      ...(src.minzoom !== undefined ? { minzoom: src.minzoom } : {}),
      ...(src.maxzoom !== undefined ? { maxzoom: src.maxzoom } : {}),
      attribution: i === 0 ? data.attribution : undefined,
    });
    map.addLayer(
      {
        id,
        type: "raster",
        source: id,
        paint: { "raster-opacity": opacity, "raster-fade-duration": 120, "raster-resampling": "nearest" },
      },
      "labels",
    );
  });
}

export function setOverlayOpacity(map: MLMap, opacity: number) {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id.startsWith(PREFIX)) map.setPaintProperty(layer.id, "raster-opacity", opacity);
  }
}
