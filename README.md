# Mangrove Atlas

[![CI](https://github.com/Flora-Carbon-AI/mangrove-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/Flora-Carbon-AI/mangrove-atlas/actions/workflows/ci.yml)

**Live:** https://mangrove-atlas-floracarbon.netlify.app

An open-source map of where mangroves grew, year by year from 1985 to 2025. Built by [Flora Carbon AI](https://floracarbon.ai) for blue-carbon project developers, researchers and coastal communities. Free to use, with no sign-up and no API keys.

You can:

- **Move through 41 years** by dragging the year slider, tapping a year, using the arrow keys, or pressing play. Changing year is instant: the data is already in your browser.
- **See gain and loss** between any two years, or compare them side by side with a swipe slider.
- **Measure mangrove area** in the current view for every year, as a bar chart with the net change.
- **Click any point** to see which years it was mangrove.
- **See blue carbon projects** from every major registry on the map, with their status, developer, credits issued and a link to the registry page.
- **Use it on a phone**: the panel and project details open as bottom sheets.
- **Switch the background map** between satellite imagery, a standard street map and a dark map.
- **Jump to well-known mangrove landscapes**: Sundarbans, Indus Delta, Abu Dhabi, Mekong, Niger Delta and more.

## Data

| Dataset | Years | Resolution | How it's served | What counts as mangrove |
|---|---|---|---|---|
| [Global Mangrove Watch v4.1.12](https://doi.org/10.5281/zenodo.21346457) | 1985–2025, annual | 30 m | Static tiles built from the Zenodo release (see below) | GMW mangrove extent |
| [ESA CCI Land Cover](https://planetarycomputer.microsoft.com/dataset/esa-cci-lc) | 1992–2020, annual | 300 m | Microsoft Planetary Computer (public) | Class 170, "tree cover, flooded, saline water" |
| [ESA WorldCover](https://planetarycomputer.microsoft.com/dataset/esa-worldcover) | 2020, 2021 | 10 m | Microsoft Planetary Computer (public) | Class 95, "mangroves" |

**Read these before using the numbers:**

- **Global Mangrove Watch is the reference dataset** for mangrove change. Its accuracy assessment reports a global F1-score of 0.93. Accuracy varies by place and year, so check the [GMW documentation](https://doi.org/10.5281/zenodo.21346457) before relying on a local result.
- **The atlas shows the uncorrected map.** GMW's official national statistics apply a 0.9775 correction for slight overestimation; the map and the in-view areas here don't. For official national figures, use GMW's statistics sheet.
- **Area figures are estimates.** They are summed from the tiles at about 38 m resolution, and edge tiles are weighted by how much of them is in view. They come within a fraction of a percent of a direct count of the source pixels, but use the native data for anything formal.
- **Zoomed out, every mangrove pixel stays visible.** Zoomed-out tiles show "mangrove anywhere in this block". Areas never use that widened version.
- **ESA CCI class 170 is a proxy.** At 300 m it misses narrow fringes and can include other saline swamp forest. WorldCover covers only 2020 and 2021, and those maps were made with different algorithm versions.

## Blue carbon projects

The projects layer lists mangrove, seagrass, salt marsh and other tidal wetland carbon projects on Verra (VCS), Gold Standard, the Climate Action Reserve and the American Carbon Registry. It is a static file, [`public/projects/blue-carbon-projects.json`](public/projects/blue-carbon-projects.json), built only from openly licensed data:

| Source | Used for | Licence |
|---|---|---|
| [Berkeley Carbon Trading Project, Voluntary Registry Offsets Database](https://gspp.berkeley.edu/berkeley-carbon-trading-project/offsets-database) (v2026-08) | The project list: IDs, names, status, developer, methodology, credits | CC BY 4.0 |
| [Karnik et al. (2024), nature-based carbon project boundaries](https://doi.org/10.5281/zenodo.11459391) | Project boundaries, where published | CC BY 4.0 |
| [GeoNames](https://www.geonames.org/) | Places named in a project's title | CC BY 4.0 |
| [Natural Earth](https://www.naturalearthdata.com/) | States and countries | Public domain |

Projects are chosen by methodology (VM0033, VM0024, AR-AM0014 and any method naming tidal, coastal wetland, seagrass or mangrove) and by blue carbon terms in the project name (mangrove, manglar, seagrass, salt marsh, tidal, mikoko and others), then checked by hand. [`pipeline/projects/curation.json`](pipeline/projects/curation.json) records every exclusion and location decision with its reason.

**How exact is each location?** Registries publish project areas as KML or PDF files whose terms don't allow republishing, so most projects aren't placed from them. Every project says how it was placed:

- **Boundary:** the project's own boundary, from Karnik et al. Shown as an outline when zoomed in.
- **Place:** a town, lagoon, island or delta named in the project's title, located with GeoNames.
- **State:** a state or province named in the title.
- **Country:** only the country is known. These are grouped into one numbered circle per country.

Solid amber dots are boundaries; ringed dots are approximate. Never use an approximate location as a project boundary.

**Not covered:** Plan Vivo and other registries that publish no open data, and projects listed after VROD v2026-08. Withdrawn, rejected and inactive projects are hidden unless you tick "Include withdrawn, rejected and inactive projects".

**To rebuild** after a new VROD release, download the inputs listed at the top of [`pipeline/projects/build_projects.py`](pipeline/projects/build_projects.py), then run:

```bash
pip install -r pipeline/projects/requirements.txt
python pipeline/projects/build_projects.py --vrod vrod.xlsx --renoster <boundaries dir> \
  --geonames <geonames dir> --ne <natural earth dir> \
  --curation pipeline/projects/curation.json --out public/projects/blue-carbon-projects.json
```

Check the summary it prints. Any project listed as `UNRESOLVED` fell back to its country: add a location for it in `curation.json` if its title names a place.

## Quick start

Requires Node.js 20 or newer.

```bash
git clone https://github.com/Flora-Carbon-AI/mangrove-atlas.git
cd mangrove-atlas
npm install
npm run dev
```

Open http://localhost:3000. Everything works straight away: Global Mangrove Watch loads from the published tiles on GitHub Pages, and the ESA layers come from Planetary Computer. To use your own build instead, export it to `public/data/gmw-v4112/` and set `NEXT_PUBLIC_GMW_TILES_URL=/data/gmw-v4112` (see `.env.example`).

## How it works

```
Browser (Next.js page, MapLibre GL)
   ├─ Global Mangrove Watch: fetches static tiles from GitHub Pages,
   │  decodes them and colours them for any year or change view
   │  (src/lib/gmw.ts). No server and no keys.
   └─ ESA datasets: /api/layers, /api/stats, /api/point proxy the public
      Microsoft Planetary Computer APIs. No keys.
```

**The tile format.** Each 512 px tile stores, for every pixel, 41 bits: one per year, set when that pixel was mangrove. The browser downloads a tile once and redraws it for any year from memory. Each tile also carries the mangrove area per year, so the area chart sums tiles instead of decoding pixels. The format is documented at the top of [`pipeline/build_tiles.py`](pipeline/build_tiles.py).

## Rebuilding the data

The tile file is generated from the official release, never edited by hand:

- **To rebuild and publish:** go to Actions → **Build mangrove tiles** → **Run workflow** on `main`. It downloads GMW v4.1.12 from Zenodo, runs `pipeline/build_tiles.py`, and publishes the tiles to GitHub Pages at https://flora-carbon-ai.github.io/mangrove-atlas/ (about 175 MB and 22,600 tiles, built in roughly 15 minutes).
- **The single-file archive** (`gmw-v4112.pmtiles`) is also kept as a workflow artifact for 30 days.
- **Automatic runs:** merging a pipeline change to `main` rebuilds and republishes. A pipeline change on a branch only builds, as a test.

To build locally (needs about 10 GB of free disk):

```bash
pip install -r pipeline/requirements.txt
python pipeline/build_tiles.py --stack <unpacked stack dir> --union <unpacked union dir> --out gmw-v4112.pmtiles
python pipeline/export_dir.py --pmtiles gmw-v4112.pmtiles --out public/data/gmw-v4112
```

Add `--bbox W,S,E,N` to the first command to build a small region for testing.

## Hosting

- **App:** Netlify. Every PR gets a deploy preview, and merging to `main` deploys production.
- **Data:** the tiles are on GitHub Pages: free, no account or card, and they don't count against Netlify's bandwidth. A typical visit loads well under 1 MB of tiles. Pages has a soft limit of about 100 GB of transfer a month. If the atlas outgrows that, copy the `gmw-v4112/` folder to any static host that sends CORS headers, and set `NEXT_PUBLIC_GMW_TILES_URL`.

## API

These routes cover the Planetary Computer datasets only; Global Mangrove Watch needs no API. All endpoints return JSON, and errors come back as `{ "error": "…" }`.

| Endpoint | Parameters | Returns |
|---|---|---|
| `GET /api/layers` | `dataset`, `year` | `{ sources: [{ tiles, bounds?, minzoom?, maxzoom? }], attribution }` |
| `GET /api/stats` | `dataset`, `bbox=west,south,east,north` | `{ regionKm2, years: [{ year, areaKm2 }] }` |
| `GET /api/point` | `dataset`, `lon`, `lat` | `{ years: [{ year, present }] }` |

`dataset` is `esa-cci-lc` or `esa-worldcover`.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. `main` is protected, so every change goes through a pull request with passing CI. Useful next steps:

- Country boundaries and GMW's official national statistics alongside the in-view area chart.
- Above-ground biomass and soil carbon layers for blue-carbon estimates.
- CSV and GeoJSON export of area statistics.

To report a security issue, see [SECURITY.md](SECURITY.md).

## Licence and attribution

**Code:** MIT (see [LICENSE](LICENSE)).

**Data:** each dataset keeps its own licence. The Global Mangrove Watch tiles published by this project are a format conversion of GMW v4.1.12 and are shared under the same **CC BY 4.0** licence. If you reuse them, credit:

> Bunting, P., Hilarides, L., Rosenqvist, A., Oakes, G., Castro Brandão Vaz dos Santos, P., Worthington, T., Rosenqvist, J., Zanaga, D., Van De Kerchove, R., Tadono, T., Kobayashi, K. (2026). *Global Mangrove Watch: Timeseries of Mangrove Extent* (Version 4.1.12). Zenodo. https://doi.org/10.5281/zenodo.21346457. Changes: reprojected to Web Mercator (~38 m) and re-encoded as map tiles by Mangrove Atlas.

Other sources:

- ESA Land Cover CCI / Copernicus Climate Change Service. *Land cover classification gridded maps from 1992 to present.* Via Microsoft Planetary Computer.
- Zanaga, D. et al. (2022). *ESA WorldCover 10 m 2021 v200.* https://doi.org/10.5281/zenodo.7254221 (CC BY 4.0). Via Microsoft Planetary Computer.
- Blue carbon projects: Berkeley Carbon Trading Project, *Voluntary Registry Offsets Database* v2026-08, Goldman School of Public Policy, UC Berkeley (CC BY 4.0); Karnik, A., Kilbride, J., Goodbody, T., Ross, R., Ayrey, E. (2024). *A global database of nature-based carbon offset project boundaries.* https://doi.org/10.5281/zenodo.11459391 (CC BY 4.0); [GeoNames](https://www.geonames.org/) (CC BY 4.0); [Natural Earth](https://www.naturalearthdata.com/) (public domain). Project boundaries have been simplified for the web.
- Basemaps: imagery © Esri, Maxar, Earthstar Geographics; [OpenFreeMap](https://openfreemap.org) © OpenMapTiles, data © OpenStreetMap contributors.
