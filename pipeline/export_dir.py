"""
Unpack the PMTiles archive into plain files for static hosting (GitHub Pages).

    out/{z}/{x}/{y}.bin   one gzip-compressed "MGA1" tile (see build_tiles.py)
    out/index.json        which tiles exist, plus the archive's metadata

The index lets the browser skip tiles that don't exist (open ocean, deserts),
so it never requests them and never logs a 404.

Usage:
    python export_dir.py --pmtiles gmw-v4112.pmtiles --out site/gmw-v4112
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from pmtiles.reader import MmapSource, Reader, all_tiles


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pmtiles", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    tiles: dict[int, list[int]] = {}
    count = 0
    total_bytes = 0
    with open(args.pmtiles, "rb") as f:
        source = MmapSource(f)
        meta = Reader(source).metadata()
        for (z, x, y), data in all_tiles(source):
            path = args.out / str(z) / str(x) / f"{y}.bin"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            tiles.setdefault(z, []).append(x * 2**z + y)
            count += 1
            total_bytes += len(data)

    index = {
        **meta,
        "attribution": (
            "Bunting, P. et al. (2026) Global Mangrove Watch: Timeseries of Mangrove Extent v4.1.12, "
            "doi:10.5281/zenodo.21346457, CC BY 4.0. Reprojected and re-encoded by Mangrove Atlas."
        ),
        "license": "CC-BY-4.0",
        "tiles": {str(z): sorted(keys) for z, keys in sorted(tiles.items())},
        "tile_key": "x * 2^z + y",
    }
    (args.out / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"Wrote {count} tiles ({total_bytes / 1e6:.1f} MB) and index.json to {args.out}")


if __name__ == "__main__":
    main()
