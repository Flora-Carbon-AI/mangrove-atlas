# Mangrove Atlas

An open-source map of where mangroves grew, year by year. Built by [Flora Carbon AI](https://floracarbon.ai) for blue-carbon project developers, researchers and coastal communities.

Mangrove Atlas works like a small, self-hostable [Global Mangrove Watch](https://www.globalmangrovewatch.org/). You can:

- **Scrub through time** on a year ribbon, or press play for a timelapse. Years without observations show as hatched gaps, so 1996 → 2007 never looks like one year apart.
- **Compare two years** with a swipe slider, or with a gain and loss layer (Global Mangrove Watch only).
- **Measure mangrove area** in the current view for every year, as a bar chart with the net change.
- **Click any point** to see which years it was mangrove.
- **Jump to well-known mangrove landscapes**: Sundarbans, Indus Delta, Abu Dhabi, Mekong, Niger Delta and more.

It runs with no credentials, using Microsoft Planetary Computer. Add a Google Earth Engine service account to unlock Global Mangrove Watch v3 (1996–2020, 25 m).

## Data

| Dataset | Years | Resolution | Provider | Needs keys? | What counts as mangrove |
|---|---|---|---|---|---|
| [Global Mangrove Watch v3](https://doi.org/10.5281/zenodo.6894273) | 1996, 2007–2010, 2015–2020 | 25 m | Google Earth Engine ([community catalog](https://gee-community-catalog.org/projects/mangrove/)) | Yes | GMW mangrove extent |
| [ESA CCI Land Cover](https://planetarycomputer.microsoft.com/dataset/esa-cci-lc) | 1992–2020, annual | 300 m | Microsoft Planetary Computer | No | Class 170, "tree cover, flooded, saline water" |
| [ESA WorldCover](https://planetarycomputer.microsoft.com/dataset/esa-worldcover) | 2020, 2021 | 10 m | Microsoft Planetary Computer | No | Class 95, "mangroves" |

**Read these before using the numbers:**

- **Global Mangrove Watch is the reference dataset** for mangrove change. Use it for anything you publish.
- **ESA CCI class 170 is a proxy.** At 300 m it misses narrow fringes and can include other saline swamp forest. It is useful for the long 1992–2020 record and for a first look, not for carbon accounting.
- **WorldCover only covers two years.** Its 2020 and 2021 maps come from different algorithm versions, so differences between them are mostly method, not change on the ground.
- **Area figures are estimates.** For Planetary Computer data the app multiplies the mangrove pixel fraction by the geodesic area of the view. Earth Engine sums `ee.Image.pixelArea()` and coarsens the scale for large views. Use the native data and a proper accuracy assessment for anything formal.

## Quick start

Requires Node.js 20 or newer.

```bash
git clone https://github.com/Flora-Carbon-AI/mangrove-atlas.git
cd mangrove-atlas
npm install
npm run dev
```

Open http://localhost:3000. The CCI and WorldCover layers work straight away.

## Turning on Global Mangrove Watch (Google Earth Engine)

1. **Get Earth Engine access.** Create or choose a Google Cloud project and [register it for Earth Engine](https://code.earthengine.google.com/register). Noncommercial use is free. Commercial use needs a paid plan.
2. **Enable the Earth Engine API** for that project in the Cloud console.
3. **Create a service account** (IAM & Admin → Service Accounts) and grant it **Earth Engine Resource Viewer** and **Service Usage Consumer**.
4. **Create a JSON key** for the service account and download it. Never commit it; `.gitignore` already excludes `*service-account*.json` and `*-key.json`.
5. **Configure the app:**
   ```bash
   cp .env.example .env.local
   ```
   Set `GEE_SERVICE_ACCOUNT_JSON` to the key file's contents on one line, or `GEE_SERVICE_ACCOUNT_JSON_BASE64` to its base64 encoding. Set `GEE_PROJECT` if the project differs from the key's `project_id`.
6. **Restart** `npm run dev`. Global Mangrove Watch becomes the default dataset.

### Check the GMW layer once

The community catalog documents the asset IDs but not how images in `GMW_V3` map to years. The app picks images whose `system:index` contains the year, then falls back to a date filter (see `gmwMask` in [`src/lib/server/ee.ts`](src/lib/server/ee.ts)). After you configure Earth Engine, open:

```
http://localhost:3000/api/status?diagnose=1
```

It lists the collection's image IDs, start times and band names. If years don't appear in the IDs or dates, adjust `gmwMask`. This check matters because the Earth Engine path was written without a live Earth Engine account, so it has not been run end to end yet. The Planetary Computer path has been run and checked against the map.

## How it works

```
Browser (Next.js page, MapLibre GL)
   │  /api/layers   → tile URL templates for a dataset + year (or a change view)
   │  /api/stats    → mangrove km² per year inside a bbox
   │  /api/point    → mangrove yes/no per year at a lon/lat
   │  /api/status   → is Earth Engine configured and reachable?
   ▼
Next.js route handlers (server only)
   ├─ Google Earth Engine: service-account auth, getMap tile URLs (cached 1 h),
   │  reduceRegion for area, gain/loss computed from two GMW years
   └─ Planetary Computer: STAC search + titiler (item tiles for CCI, a registered
      mosaic for WorldCover), band-math expressions such as lccs_class==170
```

- Credentials never reach the browser. Tile URLs come from the server, and the map loads tiles directly from Earth Engine or Planetary Computer.
- The basemap is Esri World Imagery, desaturated so the overlays stand out.
- The main files:
  - `src/lib/datasets.ts`: dataset registry (years, resolution, citation). Add datasets here.
  - `src/lib/server/ee.ts`: Earth Engine logic.
  - `src/lib/server/mpc.ts`: Planetary Computer logic.
  - `src/components/`: the map, timeline, chart and panel.

## API

All endpoints return JSON. Errors come back as `{ "error": "…" }`.

| Endpoint | Parameters | Returns |
|---|---|---|
| `GET /api/layers` | `dataset`, `year`, optional `mode=change&base=<year>` | `{ sources: [{ tiles, bounds?, minzoom?, maxzoom? }], attribution }` |
| `GET /api/stats` | `dataset`, `bbox=west,south,east,north` | `{ regionKm2, years: [{ year, areaKm2 }] }` |
| `GET /api/point` | `dataset`, `lon`, `lat` | `{ years: [{ year, present }] }` |
| `GET /api/status` | optional `diagnose` | `{ gee: { configured, ok, error? } }` |

`dataset` is `gmw-v3`, `esa-cci-lc` or `esa-worldcover`.

## Deploying

The app is a standard Next.js 16 app and deploys to Vercel, Azure App Service, Render or any Node host. Set the `GEE_*` variables in the host's environment, not in a committed file. `npm run build` copies MapLibre's web worker into `public/vendor/` before building.

## Contributing

Issues and pull requests are welcome. Useful next steps:

- Country and protected-area boundaries for area statistics, not only the current view.
- GMW v4 annual extent once its Earth Engine assets are confirmed.
- Above-ground biomass and soil carbon layers for blue-carbon estimates.
- CSV and GeoJSON export of area statistics.

Run `npm run lint` and `npm run typecheck` before opening a PR.

## Licence and citations

The code is MIT licensed (see [LICENSE](LICENSE)). The data is not: each dataset has its own terms. Cite the data you use:

- Bunting, P., Rosenqvist, A., Hilarides, L., Lucas, R.M., Thomas, T., Tadono, T., Worthington, T.A., Spalding, M., Murray, N.J., Rebelo, L-M. (2022). *Global Mangrove Extent Change 1996–2020: Global Mangrove Watch Version 3.0.* Remote Sensing 14(15), 3657. Dataset: https://doi.org/10.5281/zenodo.6894273 (CC BY 4.0). Mirrored to Earth Engine by the awesome-gee-community-catalog (Samapriya Roy).
- ESA Land Cover CCI / Copernicus Climate Change Service. *Land cover classification gridded maps from 1992 to present.* Via Microsoft Planetary Computer.
- Zanaga, D. et al. (2022). *ESA WorldCover 10 m 2021 v200.* https://doi.org/10.5281/zenodo.7254221 (CC BY 4.0). Via Microsoft Planetary Computer.
- Basemap imagery © Esri, Maxar, Earthstar Geographics.
