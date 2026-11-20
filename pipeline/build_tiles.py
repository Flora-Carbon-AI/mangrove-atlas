"""
Build the Mangrove Atlas tile archive from Global Mangrove Watch v4.1.

Input:  the GMW v4.1.12 raster stack from Zenodo (record 21346457):
        1-degree GeoTIFF tiles, 41 bands = years 1985..2025, 1 = mangrove.
Output: one PMTiles archive, served as a static file. The browser decodes it,
        so the live site needs no server code and no API keys.

Tile format ("MGA1"), gzip-compressed, one per Web Mercator z/x/y, 512x512 px:
    bytes 0..3        b"MGA1"
    bytes 4..167      float32 LE x 41: mangrove area in km² inside this tile, per year
    bytes 168..       uint8, 512*512*6: per pixel, 41 bits (bit i = year 1985+i), LE

z11 (~38 m pixels at the equator) is sampled from the source with nearest
neighbour. Lower zooms OR 2x2 pixel blocks together ("mangrove anywhere in this
block"), so thin fringes stay visible zoomed out. Areas are always summed from
z11 pixels, so they don't inflate with the OR.

Usage:
    python build_tiles.py --stack DIR --union DIR --out mangroves.pmtiles [--bbox W,S,E,N] [--workers 8]
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import struct
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject
from rasterio.windows import from_bounds as window_from_bounds
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

FIRST_YEAR = 1985
N_YEARS = 41
N_BYTES = 6  # ceil(41 / 8)
TILE = 512
MAX_Z = 11
GROUP_Z = 5  # parallelise over z5 subtrees
MAGIC = b"MGA1"
ATTRIBUTION = "Bunting, P. et al. (2026) Global Mangrove Watch: Timeseries of Mangrove Extent v4.1.12, doi:10.5281/zenodo.21346457, CC BY 4.0. Reprojected and re-encoded by Mangrove Atlas."
EARTH_CIRCUMFERENCE = 40075016.68557849
MERC_MAX = EARTH_CIRCUMFERENCE / 2


# ---------- tile maths ----------

def tile_bounds_merc(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    size = EARTH_CIRCUMFERENCE / 2**z
    west = -MERC_MAX + x * size
    north = MERC_MAX - y * size
    return west, north - size, west + size, north


def merc_y_to_lat(my: float) -> float:
    return math.degrees(2 * math.atan(math.exp(my / 6378137.0)) - math.pi / 2)


def tile_bounds_lonlat(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    w, s, e, n = tile_bounds_merc(z, x, y)
    return w / MERC_MAX * 180, merc_y_to_lat(s), e / MERC_MAX * 180, merc_y_to_lat(n)


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180) / 360 * n)
    lat = max(min(lat, 85.0511), -85.0511)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def row_pixel_area_km2(z: int, y: int) -> np.ndarray:
    """True ground area (km²) of one pixel in each row of a 512 px tile."""
    w, s, e, n = tile_bounds_merc(z, 0, y)
    px = EARTH_CIRCUMFERENCE / 2**z / TILE
    rows = n - (np.arange(TILE) + 0.5) * px
    lat = np.radians([merc_y_to_lat(v) for v in rows])
    return (px * np.cos(lat)) ** 2 / 1e6


# ---------- source index ----------



def index_dir(d: Path) -> dict[tuple[int, int], Path]:
    """Map the (lon, lat) of each 1-degree tile's NW corner to its GeoTIFF."""
    out: dict[tuple[int, int], Path] = {}
    for p in (q for q in d.rglob("*.tif") if not q.name.startswith("._")):
        with rasterio.open(p) as src:
            b = src.bounds
        out[(round(b.left), round(b.top))] = p
    return out


def sources_for(bounds_ll, index):
    w, s, e, n = bounds_ll
    found = []
    for lon in range(math.floor(w), math.ceil(e)):
        for lat_top in range(math.floor(s) + 1, math.ceil(n) + 1):
            p = index.get((lon, lat_top))
            if p is not None:
                found.append(p)
    return found


# ---------- reading one z11 tile ----------

def read_z11(z: int, x: int, y: int, stack_index) -> np.ndarray | None:
    """Return (512, 512, 6) uint8 packed year bits, or None when empty."""
    bounds_ll = tile_bounds_lonlat(z, x, y)
    srcs = sources_for(bounds_ll, stack_index)
    if not srcs:
        return None
    dst_transform = from_bounds(*tile_bounds_merc(z, x, y), TILE, TILE)
    acc = np.zeros((N_YEARS, TILE, TILE), dtype=np.uint8)
    w, s, e, n = bounds_ll
    for p in srcs:
        with rasterio.open(p) as src:
            win = window_from_bounds(w, s, e, n, transform=src.transform)
            # One pixel of margin so nearest-neighbour sampling at the edges has data.
            col0 = max(0, math.floor(win.col_off) - 1)
            row0 = max(0, math.floor(win.row_off) - 1)
            col1 = min(src.width, math.ceil(win.col_off + win.width) + 1)
            row1 = min(src.height, math.ceil(win.row_off + win.height) + 1)
            if col1 <= col0 or row1 <= row0:
                continue
            win = rasterio.windows.Window(col0, row0, col1 - col0, row1 - row0)
            data = src.read(window=win)
            if not data.any():
                continue
            data = (data == 1).astype(np.uint8)
            dst = np.zeros_like(acc)
            reproject(
                source=data,
                destination=dst,
                src_transform=src.window_transform(win),
                src_crs=src.crs,
                dst_transform=dst_transform,
                dst_crs="EPSG:3857",
                resampling=Resampling.nearest,
                src_nodata=None,
                dst_nodata=None,
            )
            np.maximum(acc, dst, out=acc)
    if not acc.any():
        return None
    packed = np.packbits(acc, axis=0, bitorder="little")  # (6, 512, 512)
    return np.ascontiguousarray(packed.transpose(1, 2, 0))


def year_areas(packed: np.ndarray, z: int, y: int) -> np.ndarray:
    """km² of mangrove per year in a z11 tile."""
    bits = np.unpackbits(packed, axis=2, bitorder="little")[:, :, :N_YEARS]  # (512, 512, 41)
    per_row = bits.sum(axis=1, dtype=np.int64)  # (512, 41)
    return (per_row * row_pixel_area_km2(z, y)[:, None]).sum(axis=0)


def downsample_or(children: list[np.ndarray | None]) -> np.ndarray:
    """Combine 4 child tiles (NW, NE, SW, SE) into one parent tile with 2x2 OR."""
    full = np.zeros((TILE * 2, TILE * 2, N_BYTES), dtype=np.uint8)
    for i, c in enumerate(children):
        if c is not None:
            r, q = divmod(i, 2)
            full[r * TILE : (r + 1) * TILE, q * TILE : (q + 1) * TILE] = c
    f = full.reshape(TILE, 2, TILE, 2, N_BYTES)
    return f[:, 0, :, 0] | f[:, 0, :, 1] | f[:, 1, :, 0] | f[:, 1, :, 1]


def encode(packed: np.ndarray, areas: np.ndarray) -> bytes:
    payload = MAGIC + struct.pack(f"<{N_YEARS}f", *areas.astype(np.float32)) + packed.tobytes()
    return gzip.compress(payload, compresslevel=9, mtime=0)


# ---------- subtree worker ----------

_STACK: dict | None = None
_CANDIDATES: set[tuple[int, int, int]] | None = None  # (z, x, y) at every zoom


def _init(stack_index: dict, candidates: set[tuple[int, int, int]]):
    global _STACK, _CANDIDATES
    _STACK = stack_index
    _CANDIDATES = candidates


def build_subtree(gz: int, gx: int, gy: int):
    """Depth-first build of every tile from (gz, gx, gy) down to z11."""
    out: list[tuple[int, bytes]] = []

    def visit(z, x, y):
        if (z, x, y) not in _CANDIDATES:
            return None, None
        if z == MAX_Z:
            packed = read_z11(z, x, y, _STACK)
            if packed is None:
                return None, None
            areas = year_areas(packed, z, y)
        else:
            kids = [visit(z + 1, 2 * x + dx, 2 * y + dy) for dy in (0, 1) for dx in (0, 1)]
            if all(k[0] is None for k in kids):
                return None, None
            packed = downsample_or([k[0] for k in kids])
            areas = sum((k[1] for k in kids if k[1] is not None), np.zeros(N_YEARS))
        out.append((zxy_to_tileid(z, x, y), encode(packed, areas)))
        return packed, areas

    packed, areas = visit(gz, gx, gy)
    return (gz, gx, gy), packed, areas, out


# ---------- candidates from the union layer ----------

def find_candidates(union_dir: Path, bbox) -> set[tuple[int, int]]:
    """z11 tiles that contain mangrove in any year, from the union raster."""
    n = 2**MAX_Z
    keys: set[int] = set()
    for p in (q for q in union_dir.rglob("*.tif") if not q.name.startswith("._")):
        with rasterio.open(p) as src:
            b = src.bounds
            if bbox and (b.right <= bbox[0] or b.left >= bbox[2] or b.top <= bbox[1] or b.bottom >= bbox[3]):
                continue
            data = src.read(1)
            rows, cols = np.nonzero(data == 1)
            if rows.size == 0:
                continue
            t = src.transform
            lons = t.c + (cols + 0.5) * t.a
            lats = t.f + (rows + 0.5) * t.e
            if bbox:
                keep = (lons >= bbox[0]) & (lons <= bbox[2]) & (lats >= bbox[1]) & (lats <= bbox[3])
                lons, lats = lons[keep], lats[keep]
            tx = np.clip(((lons + 180) / 360 * n).astype(np.int64), 0, n - 1)
            lat_r = np.radians(np.clip(lats, -85.0511, 85.0511))
            ty = np.clip(((1 - np.arcsinh(np.tan(lat_r)) / np.pi) / 2 * n).astype(np.int64), 0, n - 1)
            keys.update(np.unique(tx * n + ty).tolist())
    return {(k // n, k % n) for k in keys}


def with_ancestors(z11: set[tuple[int, int]]) -> set[tuple[int, int, int]]:
    out = set()
    for x, y in z11:
        for z in range(MAX_Z + 1):
            s = MAX_Z - z
            out.add((z, x >> s, y >> s))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stack", required=True, type=Path)
    ap.add_argument("--union", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--bbox", help="W,S,E,N to build a subset (for testing)")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 4)
    args = ap.parse_args()
    bbox = tuple(map(float, args.bbox.split(","))) if args.bbox else None

    t0 = time.time()
    cands = find_candidates(args.union, bbox)
    print(f"{len(cands)} candidate z11 tiles ({time.time() - t0:.0f}s)", flush=True)
    if not cands:
        sys.exit("No mangrove found in the requested area.")

    shift = MAX_Z - GROUP_Z
    groups = sorted({(cx >> shift, cy >> shift) for cx, cy in cands})
    stack_index = index_dir(args.stack)
    print(f"{len(stack_index)} source tiles, {len(groups)} z{GROUP_Z} groups, {args.workers} workers", flush=True)

    top: dict[tuple[int, int, int], tuple[np.ndarray, np.ndarray]] = {}
    n_tiles = 0
    with open(args.out, "wb") as f:
        writer = Writer(f)
        with ProcessPoolExecutor(args.workers, initializer=_init, initargs=(stack_index, with_ancestors(cands))) as pool:
            futures = [pool.submit(build_subtree, GROUP_Z, gx, gy) for gx, gy in groups]
            for i, fut in enumerate(as_completed(futures), 1):
                key, packed, areas, tiles = fut.result()
                for tid, data in tiles:
                    writer.write_tile(tid, data)
                n_tiles += len(tiles)
                if packed is not None:
                    top[key] = (packed, areas)
                print(f"  group {i}/{len(groups)} done, {n_tiles} tiles, {time.time() - t0:.0f}s", flush=True)

        # Zooms below the group level, built from the group roots.
        level = {(x, y): v for (z, x, y), v in top.items()}
        for z in range(GROUP_Z - 1, -1, -1):
            parents: dict[tuple[int, int], list] = {}
            for (x, y), v in level.items():
                parents.setdefault((x // 2, y // 2), [None] * 4)[(y % 2) * 2 + (x % 2)] = v
            level = {}
            for (x, y), kids in parents.items():
                packed = downsample_or([k[0] if k else None for k in kids])
                areas = sum((k[1] for k in kids if k), np.zeros(N_YEARS))
                writer.write_tile(zxy_to_tileid(z, x, y), encode(packed, areas))
                n_tiles += 1
                level[(x, y)] = (packed, areas)

        total = next(iter(level.values()))[1] if len(level) == 1 else None
        b = bbox or (-180.0, -45.0, 180.0, 45.0)
        writer.finalize(
            {
                "tile_type": TileType.UNKNOWN,
                "tile_compression": Compression.GZIP,
                "min_lon_e7": int(b[0] * 1e7),
                "min_lat_e7": int(b[1] * 1e7),
                "max_lon_e7": int(b[2] * 1e7),
                "max_lat_e7": int(b[3] * 1e7),
                "center_zoom": 3,
                "center_lon_e7": int((b[0] + b[2]) / 2 * 1e7),
                "center_lat_e7": int((b[1] + b[3]) / 2 * 1e7),
            },
            {
                "name": "Global Mangrove Watch v4.1.12, annual extent 1985-2025",
                "format": "MGA1",
                "first_year": FIRST_YEAR,
                "years": N_YEARS,
                "tile_size": TILE,
                "max_native_zoom": MAX_Z,
                "attribution": ATTRIBUTION,
                "source": "https://doi.org/10.5281/zenodo.21346457",
                "total_km2_by_year": [round(float(v), 1) for v in total] if total is not None else None,
            },
        )
    size = args.out.stat().st_size
    print(f"Wrote {n_tiles} tiles, {size / 1e6:.1f} MB, in {time.time() - t0:.0f}s", flush=True)
    if total is not None:
        print("Total km² 1985 / 2000 / 2025:", round(total[0]), round(total[15]), round(total[40]))


if __name__ == "__main__":
    main()
