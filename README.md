# Mangrove Atlas

[![CI](https://github.com/Flora-Carbon-AI/mangrove-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/Flora-Carbon-AI/mangrove-atlas/actions/workflows/ci.yml)

**Live:** https://mangrove-atlas-floracarbon.netlify.app

An open-source map of where mangroves grew, year by year. Built by [Flora Carbon AI](https://floracarbon.ai) for blue-carbon project developers, researchers and coastal communities.

Mangrove Atlas works like a small, self-hostable [Global Mangrove Watch](https://www.globalmangrovewatch.org/). You can:

- **Move through time** by dragging the year slider, tapping a year, using the arrow keys, or pressing play for a timelapse. Years without observations show as hatched gaps, so 1996 → 2007 never looks like one year apart.
- **Compare two years** with a swipe slider, or with a gain and loss layer (Earth Engine datasets).
- **Measure mangrove area** in the current view for every year, as a bar chart with the net change.
- **Click any point** to see which years it was mangrove.
- **Switch the background map** between satellite imagery, a standard street map and a dark map.
- **Jump to well-known mangrove landscapes**: Sundarbans, Indus Delta, Abu Dhabi, Mekong, Niger Delta and more.

It runs with no credentials, using Microsoft Planetary Computer (1992–2021). Add a Google Earth Engine service account to unlock Global Mangrove Watch v3 (1996–2020, 25 m) and Global Annual Mangrove Extent (1984–2023, 30 m).

## Data

| Dataset | Years | Resolution | Provider | Needs keys? | What counts as mangrove |
|---|---|---|---|---|---|
| [Global Annual Mangrove Extent](https://developers.google.com/earth-engine/datasets/catalog/projects_mangrovedatahub2_assets_CGMD-Extent30) (CGMD) | 1984–2023, annual | 30 m | Google Earth Engine (official catalog) | Yes | Mapped mangrove polygons for each `year` |
| [Global Mangrove Watch v3](https://doi.org/10.5281/zenodo.6894273) | 1996, 2007–2010, 2015–2020 | 25 m | Google Earth Engine ([community catalog](https://gee-community-catalog.org/projects/mangrove/)) | Yes | GMW mangrove extent |
| [ESA CCI Land Cover](https://planetarycomputer.microsoft.com/dataset/esa-cci-lc) | 1992–2020, annual | 300 m | Microsoft Planetary Computer | No | Class 170, "tree cover, flooded, saline water" |
| [ESA WorldCover](https://planetarycomputer.microsoft.com/dataset/esa-worldcover) | 2020, 2021 | 10 m | Microsoft Planetary Computer | No | Class 95, "mangroves" |

**Read these before using the numbers:**

- **Global Mangrove Watch and CGMD are mangrove-specific products.** Use them for anything you publish.
- **CGMD has a known one-year lag on some changes.** Changes late in a year can appear in the next year's map. Losses shorter than three years are treated as degradation and stay mapped as mangrove.
- **ESA CCI class 170 is a proxy.** At 300 m it misses narrow fringes and can include other saline swamp forest. It is useful for the long 1992–2020 record and for a first look, not for carbon accounting.
- **WorldCover only covers two years.** Its 2020 and 2021 maps come from different algorithm versions, so differences between them are mostly method, not change on the ground.
- **Area figures are estimates.** For Planetary Computer data the app multiplies the mangrove pixel fraction by the geodesic area of the view. Earth Engine rasterises the data and sums `ee.Image.pixelArea()`, coarsening the scale for large views. Use the native data and a proper accuracy assessment for anything formal.
- **Zoomed out, small patches vanish on the Planetary Computer layers**, because they become smaller than one screen pixel. The Earth Engine layers widen mangroves by one screen pixel *for display only* so they stay visible; area figures never use the widened version.

Newer releases exist but are not in Earth Engine yet. [GMW v4.1](https://www.eorc.jaxa.jp/ALOS/en/dataset/gmw_e.htm) covers 1985–2025 at 30 m, distributed via Zenodo. Adding it would mean uploading it as an Earth Engine asset; contributions are welcome.

## Quick start

Requires Node.js 20 or newer.

```bash
git clone https://github.com/Flora-Carbon-AI/mangrove-atlas.git
cd mangrove-atlas
npm install
npm run dev
```

Open http://localhost:3000. The CCI and WorldCover layers work straight away.

## Turning on Earth Engine

1. **Get Earth Engine access.** Create or choose a Google Cloud project and [register it for Earth Engine](https://code.earthengine.google.com/register). Noncommercial use is free. Commercial use needs a paid plan.
2. **Enable the Earth Engine API** for that project in the Cloud console.
3. **Create a dedicated service account** for this app (IAM & Admin → Service Accounts). Grant it only **Earth Engine Resource Viewer** and **Service Usage Consumer**. It only reads public datasets.
4. **Create a JSON key** for the service account. Never commit it; `.gitignore` already excludes `*service-account*.json` and `*-key.json`.
5. **Configure the app** (`cp .env.example .env.local`). Set:
   - `GEE_CLIENT_EMAIL`: the key's `client_email`.
   - `GEE_PRIVATE_KEY`: the key's `private_key`, including the `-----BEGIN/END PRIVATE KEY-----` lines. Literal `\n` sequences are fine.
   - `GEE_PROJECT`: your Cloud project ID.

   Two separate variables keep you under the roughly 4 KB limit that serverless hosts put on all environment variables combined. A whole key file (`GEE_SERVICE_ACCOUNT_JSON` or `GEE_SERVICE_ACCOUNT_JSON_BASE64`) also works locally.
6. **Restart** `npm run dev`. Global Annual Mangrove Extent becomes the default dataset.

### Check the Earth Engine layers once

These code paths were written against the catalog documentation and have not yet been run against a live account. After configuring Earth Engine, open:

```
http://localhost:3000/api/status?diagnose=1
```

It reports:

- the GMW v3 image IDs, start times and band names. If years don't appear in them, adjust `gmwMask` in [`src/lib/server/ee.ts`](src/lib/server/ee.ts).
- one CGMD feature and the post-2020 years it contains.

### Adding the key to Netlify safely

It is safe to add the key to Netlify, as long as you treat it as a server secret.

- **Where:** Netlify → Project configuration → Environment variables.
- **Mark the values as secret** and scope them to **Functions** only. The key is only read on the server, in `src/lib/server/ee.ts`. It is never sent to the browser, and the build doesn't need it.
- **Limit deploy contexts.** Make the variables available to **Production** (and Deploy Previews only if you need them). Previews of pull requests from forks don't build until a maintainer approves them, because preview builds run the PR's code. Review a fork's PR before approving its preview.
- **Contain the damage if it leaks.** Use the dedicated, read-only service account from step 3, in its own Cloud project. Set a budget alert on that project, and rotate the key if you suspect it leaked.
- **Expect public traffic.** Anyone visiting the site uses your Earth Engine quota through `/api/*`. Watch usage in the Cloud console.

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
   │  reduceRegion for area, gain/loss computed from two years
   └─ Planetary Computer: STAC search + titiler (item tiles for CCI, a registered
      mosaic for WorldCover), band-math expressions such as lccs_class==170
```

- Credentials never reach the browser. Tile URLs come from the server, and the map loads tiles directly from Earth Engine or Planetary Computer.
- Background maps: Esri World Imagery (satellite), and OpenFreeMap Positron and Dark (open OpenStreetMap vector maps, no API key needed).
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

`dataset` is `cgmd-30`, `gmw-v3`, `esa-cci-lc` or `esa-worldcover`.

## Deploying

The live site runs on Netlify and deploys automatically:

- **Merging to `main`** deploys to production.
- **Every pull request** gets a deploy preview link.

`netlify.toml` holds the build settings, and Netlify's Next.js runtime turns `/api/*` into functions. The app also deploys to Vercel, Azure App Service, Render or any Node host. Set the `GEE_*` variables in the host's environment, never in a committed file. `npm run build` copies MapLibre's web worker into `public/vendor/` before building.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. `main` is protected, so every change goes through a pull request with passing CI. Useful next steps:

- GMW v4.1 (1985–2025) as an Earth Engine asset.
- Country and protected-area boundaries for area statistics, not only the current view.
- Above-ground biomass and soil carbon layers for blue-carbon estimates.
- CSV and GeoJSON export of area statistics.

To report a security issue, see [SECURITY.md](SECURITY.md).

## Licence and citations

The code is MIT licensed (see [LICENSE](LICENSE)). The data is not: each dataset has its own terms. Cite the data you use:

- Zhang, Z., Murray, N., Song, X., … & Friess, D. (2026). *Unexpected expansion and regrowth in Earth's mangrove forests over the past four decades.* Science. https://doi.org/10.1126/science.aec9773. Data: Continuous Global Mangrove Dynamics / The Mangrove Lab (CC BY 4.0), via the Earth Engine Data Catalog.
- Bunting, P., Rosenqvist, A., Hilarides, L., Lucas, R.M., Thomas, T., Tadono, T., Worthington, T.A., Spalding, M., Murray, N.J., Rebelo, L-M. (2022). *Global Mangrove Extent Change 1996–2020: Global Mangrove Watch Version 3.0.* Remote Sensing 14(15), 3657. Dataset: https://doi.org/10.5281/zenodo.6894273 (CC BY 4.0). Mirrored to Earth Engine by the awesome-gee-community-catalog (Samapriya Roy).
- ESA Land Cover CCI / Copernicus Climate Change Service. *Land cover classification gridded maps from 1992 to present.* Via Microsoft Planetary Computer.
- Zanaga, D. et al. (2022). *ESA WorldCover 10 m 2021 v200.* https://doi.org/10.5281/zenodo.7254221 (CC BY 4.0). Via Microsoft Planetary Computer.
- Basemaps: imagery © Esri, Maxar, Earthstar Geographics; [OpenFreeMap](https://openfreemap.org) © OpenMapTiles, data © OpenStreetMap contributors.
