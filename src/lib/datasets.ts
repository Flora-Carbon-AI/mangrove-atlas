/**
 * Dataset registry shared by the client and the API routes.
 *
 * Two providers, neither needs credentials:
 *  - "static": a prebuilt tile archive decoded in the browser (src/lib/gmw.ts).
 *  - "mpc": Microsoft Planetary Computer, proxied by the /api routes.
 */

export type Provider = "static" | "mpc";

export type DatasetId = "gmw-v4" | "esa-cci-lc" | "esa-worldcover";

export interface Dataset {
  id: DatasetId;
  provider: Provider;
  name: string;
  /** One-line description shown in the dataset picker. */
  summary: string;
  resolution: string;
  years: number[];
  /** Lowest zoom at which the provider will serve tiles. */
  minZoom: number;
  /** Whether the provider can compute gain / loss between two years. */
  supportsChange: boolean;
  /** Largest bbox edge (degrees) we will measure in one request. */
  maxStatsSpanDeg: number;
  citation: string;
  license: string;
  sourceUrl: string;
}

const range = (a: number, b: number) =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const DATASETS: Record<DatasetId, Dataset> = {
  "gmw-v4": {
    id: "gmw-v4",
    provider: "static",
    name: "Global Mangrove Watch v4.1",
    summary:
      "Yearly mangrove extent from 1985 to 2025, mapped from Landsat and radar. The reference dataset for mangrove change.",
    resolution: "30 m",
    years: range(1985, 2025),
    minZoom: 0,
    supportsChange: true,
    // Stats are summed from tiles in the browser, so any view size works.
    maxStatsSpanDeg: 360,
    citation:
      "Bunting, P. et al. (2026). Global Mangrove Watch: Timeseries of Mangrove Extent (Version 4.1.12). Zenodo. doi:10.5281/zenodo.21346457",
    license: "CC BY 4.0",
    sourceUrl: "https://doi.org/10.5281/zenodo.21346457",
  },
  "esa-cci-lc": {
    id: "esa-cci-lc",
    provider: "mpc",
    name: "ESA CCI Land Cover (saline flooded forest)",
    summary:
      "Annual global land cover. Class 170, tree cover flooded with saline water, is a coarse proxy for mangroves.",
    resolution: "300 m",
    years: range(1992, 2020),
    minZoom: 0,
    supportsChange: false,
    maxStatsSpanDeg: 8,
    citation:
      "ESA Land Cover CCI / Copernicus Climate Change Service (2019). Land cover classification gridded maps from 1992 to present. Accessed via Microsoft Planetary Computer.",
    license: "ESA CCI / C3S licence",
    sourceUrl: "https://planetarycomputer.microsoft.com/dataset/esa-cci-lc",
  },
  "esa-worldcover": {
    id: "esa-worldcover",
    provider: "mpc",
    name: "ESA WorldCover (mangroves class)",
    summary:
      "10 m global land cover from Sentinel-1 and Sentinel-2, with a dedicated mangroves class (95).",
    resolution: "10 m",
    years: [2020, 2021],
    minZoom: 6,
    supportsChange: false,
    maxStatsSpanDeg: 1.5,
    citation:
      "Zanaga, D. et al. (2022). ESA WorldCover 10 m 2021 v200. Accessed via Microsoft Planetary Computer.",
    license: "CC BY 4.0",
    sourceUrl: "https://planetarycomputer.microsoft.com/dataset/esa-worldcover",
  },
};

export const DATASET_ORDER: DatasetId[] = [
  "gmw-v4",
  "esa-cci-lc",
  "esa-worldcover",
];

export type Basemap = "satellite" | "standard" | "dark";

export const BASEMAPS: { id: Basemap; label: string }[] = [
  { id: "satellite", label: "Satellite" },
  { id: "standard", label: "Standard" },
  { id: "dark", label: "Dark" },
];

export function isDatasetId(v: string | null): v is DatasetId {
  return v !== null && v in DATASETS;
}

/** Colours shared by the map layers and the UI legend. */
export const COLORS = {
  mangrove: "#49C27A",
  gain: "#4FB6E8",
  loss: "#EE6A50",
} as const;

export type BBox = [west: number, south: number, east: number, north: number];

export interface Place {
  name: string;
  country: string;
  center: [number, number];
  zoom: number;
}

/** Well-known mangrove landscapes to jump to. */
export const PLACES: Place[] = [
  { name: "Sundarbans", country: "Bangladesh / India", center: [89.25, 21.95], zoom: 9 },
  { name: "Indus Delta", country: "Pakistan", center: [67.45, 24.2], zoom: 9 },
  { name: "Abu Dhabi coast", country: "United Arab Emirates", center: [54.45, 24.45], zoom: 10 },
  { name: "Mekong Delta", country: "Vietnam", center: [105.0, 8.85], zoom: 9 },
  { name: "Niger Delta", country: "Nigeria", center: [6.4, 4.55], zoom: 9 },
  { name: "Rufiji Delta", country: "Tanzania", center: [39.3, -7.85], zoom: 10 },
  { name: "Bintuni Bay", country: "Indonesia", center: [133.3, -2.25], zoom: 9 },
  { name: "Everglades", country: "United States", center: [-81.0, 25.35], zoom: 9 },
  { name: "Amapá coast", country: "Brazil", center: [-50.5, 1.9], zoom: 8 },
];
