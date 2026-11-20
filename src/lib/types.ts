import type { BBox, DatasetId } from "./datasets";

/** One raster tile source for MapLibre. */
export interface TileSource {
  tiles: string[];
  bounds?: BBox;
  minzoom?: number;
  maxzoom?: number;
  /** Pixel size of the source's tiles (default 256). */
  tileSize?: number;
}

export interface LayersResponse {
  dataset: DatasetId;
  year: number;
  base?: number;
  mode: "extent" | "change";
  sources: TileSource[];
  attribution: string;
}

export interface YearArea {
  year: number;
  areaKm2: number;
}

export interface StatsResponse {
  dataset: DatasetId;
  bbox: BBox;
  regionKm2: number;
  years: YearArea[];
}

export interface PointResponse {
  dataset: DatasetId;
  lon: number;
  lat: number;
  years: { year: number; present: boolean | null }[];
}

export interface ApiError {
  error: string;
}
