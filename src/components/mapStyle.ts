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

/** Replaces the mangrove overlay on a map with the sources in `data`. */
export function applyOverlay(map: MLMap, data: LayersResponse | null, opacity: number) {
  const style = map.getStyle();
  for (const layer of style.layers ?? []) {
    if (layer.id.startsWith(PREFIX)) map.removeLayer(layer.id);
  }
  for (const id of Object.keys(style.sources ?? {})) {
    if (id.startsWith(PREFIX)) map.removeSource(id);
  }
  if (!data) return;
  data.sources.forEach((src, i) => {
    const id = `${PREFIX}${i}`;
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
