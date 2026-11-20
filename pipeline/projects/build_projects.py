"""
Build the blue carbon projects layer from open data only.

Inputs (all openly licensed, downloaded by the caller):
  --vrod      Berkeley Carbon Trading Project, Voluntary Registry Offsets Database
              (xlsx, CC BY 4.0): the list of projects and their attributes.
  --renoster  Folder with Renoster's carbon project boundary GeoPackages and index
              (Karnik et al. 2024, Zenodo 10.5281/zenodo.11459391, CC BY 4.0).
  --geonames  Folder with GeoNames country dumps (XX.zip) and cities500.zip (CC BY 4.0).
  --ne        Folder with Natural Earth admin0/admin1 GeoJSON (public domain).

Registry websites are never scraped: their terms forbid republishing.

Every project gets a location with an explicit precision:
  boundary  official or georeferenced project boundary (Renoster)
  site      a single georeferenced point (Renoster)
  place     a town, lagoon, island or delta named in the project's own title, from GeoNames
  state     a state/province named in the project's title, at Natural Earth's label point
  country   only the country is known; the map groups these per country

Usage:
  python build_projects.py --vrod vrod.xlsx --renoster DIR --geonames DIR --ne DIR \
      --curation curation.json --out ../../public/projects/blue-carbon-projects.json
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

import openpyxl

FILTER_METHOD = re.compile(r"VM0033|VM0024|AR-AM0014|coastal wetland|deltaic|tidal|seagrass|blue carbon|mangrove", re.I)
FILTER_NAME = re.compile(
    r"mangrove|manglar|mangue|mangal|bakau|seagrass|sea ?grass|tidal|salt ?marsh|blue carbon|blue forest|"
    r"mikoko|coastal wetland|delta blue|sundarban|estuar",
    re.I,
)
INACTIVE = re.compile(r"withdrawn|rejected|inactive|on hold|cancel", re.I)
COUNTRY_ALIASES = {"DRC": "CD", "Gambia": "GM", "Timor-Leste": "TL", "Guinea-Bissau": "GW", "United States": "US"}
REGISTRY_NAMES = {"VCS": "Verra", "GOLD": "Gold Standard", "CAR": "Climate Action Reserve", "ACR": "American Carbon Registry"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def registry_url(pid: str) -> str | None:
    m = re.match(r"([A-Z]+)(\d+)$", pid)
    if not m:
        return None
    reg, num = m.groups()
    return {
        "VCS": f"https://registry.verra.org/verra/public/program/VCS/projects/{num}",
        "GS": f"https://registry.goldstandard.org/projects/details/{num}",
        "CAR": f"https://thereserve2.apx.com/mymodule/reg/prjView.asp?id1={num}",
        "ACR": f"https://acr2.apx.com/mymodule/reg/prjView.asp?id1={num}",
    }.get(reg)


def ecosystem(names: str) -> str:
    """From the project's own name(s) only. Methodology titles are generic
    (VM0033 is "Tidal Wetland and Seagrass Restoration") and would mislabel projects."""
    t = names.lower()
    if re.search(r"mangrove|manglar|mangue|bakau", t):
        return "mangrove"
    if "seagrass" in t or "sea grass" in t:
        return "seagrass"
    if re.search(r"salt ?marsh|lagoon|lagunare", t):
        return "salt marsh / lagoon"
    return "tidal wetland"


def status_group(status: str, issued: float) -> str:
    if INACTIVE.search(status or ""):
        return "inactive"
    if issued and issued > 0:
        return "issuing"
    if re.search(r"registered|certified project|late to verify|verification", status or "", re.I):
        return "registered"
    return "in development"


# ---------- reference data ----------

def load_countries(ne: Path) -> dict[str, dict]:
    data = json.loads((ne / "admin0.geojson").read_text(encoding="utf-8"))
    by = {}
    for f in data["features"]:
        p = f["properties"]
        iso = p.get("ISO_A2_EH") or p.get("ISO_A2")
        rec = {"iso": iso, "name": p["NAME"], "lon": p["LABEL_X"], "lat": p["LABEL_Y"]}
        for k in ("NAME", "NAME_LONG", "ADMIN", "NAME_EN", "FORMAL_EN"):
            if p.get(k):
                by[norm(p[k])] = rec
        by[iso] = rec
    return by


def load_admin1(ne: Path) -> list[dict]:
    from shapely.geometry import shape

    data = json.loads((ne / "admin1.geojson").read_text(encoding="utf-8"))
    return [
        {
            "iso": f["properties"].get("iso_a2"),
            "names": {norm(f["properties"].get(k) or "") for k in ("name", "name_en", "woe_name", "gn_name", "name_alt")} - {""},
            "name": f["properties"].get("name"),
            "lon": f["properties"].get("longitude"),
            "lat": f["properties"].get("latitude"),
            "shape": shape(f["geometry"]) if f.get("geometry") else None,
        }
        for f in data["features"]
    ]


def find_admin1(admin1: list[dict], iso: str, name: str) -> dict | None:
    return next((a for a in admin1 if a["iso"] == iso and norm(name) in a["names"]), None)


_GN: dict[str, list[list[str]]] = {}


def geonames(gdir: Path, iso: str) -> list[list[str]]:
    if iso in _GN:
        return _GN[iso]
    rows: list[list[str]] = []
    z = gdir / f"{iso}.zip"
    if z.exists():
        with zipfile.ZipFile(z) as zf:
            with zf.open(f"{iso}.txt") as fh:
                rows = [line.split("\t") for line in io.TextIOWrapper(fh, encoding="utf-8")]
    _GN[iso] = rows
    return rows


def gn_candidates(gdir: Path, iso: str, name: str, kind: str):
    """GeoNames entries in a country whose name matches. Tier 3 = primary name, 2 = alternate name, 1 = partial."""
    want = norm(name)
    classes = {"P"} if kind == "place" else {"H", "L", "T", "A", "P", "S"}
    out = []
    for r in geonames(gdir, iso):
        if len(r) < 15 or r[6] not in classes:
            continue
        primary = {norm(r[1]), norm(r[2])}
        alternates = {norm(a) for a in r[3].split(",") if a}
        if want in primary:
            tier = 3
        elif want in alternates:
            tier = 2
        elif any(n.startswith(want + " ") or n.endswith(" " + want) for n in primary):
            tier = 1
        else:
            continue
        out.append({"tier": tier, "row": r, "pop": int(r[14] or 0), "natural": r[6] in ("H", "L", "T")})
    return out


def gn_lookup(gdir: Path, iso: str, name: str, kind: str, admin1_area: dict | None):
    """Best GeoNames match, or None. When a state is named, the match must lie inside it."""
    from shapely.geometry import Point

    cands = gn_candidates(gdir, iso, name, kind)
    if admin1_area and admin1_area.get("shape") is not None:
        cands = [c for c in cands if admin1_area["shape"].contains(Point(float(c["row"][5]), float(c["row"][4])))]
    if not cands:
        return None
    best = max(c["tier"] for c in cands)
    cands = [c for c in cands if c["tier"] == best]
    if kind == "region":
        cands.sort(key=lambda c: (c["natural"], c["pop"]), reverse=True)
    else:
        cands.sort(key=lambda c: c["pop"], reverse=True)
    r = cands[0]["row"]
    return float(r[5]), float(r[4]), r[1], r[7], r[0]


def gn_by_id(gdir: Path, iso: str, geonameid: str):
    for r in geonames(gdir, iso):
        if r and r[0] == str(geonameid):
            return float(r[5]), float(r[4]), r[1], r[7], r[0]
    return None


# ---------- Renoster boundaries ----------

def load_renoster(rdir: Path, wanted: set[str]) -> dict[str, dict]:
    import pyogrio
    import pyogrio.raw
    import shapely
    from shapely.geometry import mapping
    from shapely.ops import unary_union

    out: dict[str, dict] = {}
    index = {}
    with open(rdir / "carbon_projects_database_index.csv", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["ProjectID"] in wanted:
                index[row["ProjectID"]] = row
    if not index:
        return out
    ids = "','".join(index)
    parts: dict[str, list] = {}
    for gpkg in sorted(rdir.glob("*.gpkg")):
        for layer, _ in pyogrio.list_layers(gpkg):
            meta, _fids, geoms, fields = pyogrio.raw.read(gpkg, layer=layer, where=f"\"ProjectID\" IN ('{ids}')")
            if geoms is None or len(geoms) == 0:
                continue
            cols = {name: fields[i] for i, name in enumerate(meta["fields"])}
            for i, wkb in enumerate(geoms):
                pid = cols["ProjectID"][i]
                # The "Project Area" column holds the overall project area as WKT text
                # (accounting areas and reference regions are separate columns). Fall
                # back to the feature geometry when it's empty.
                area = cols["Project Area"][i]
                if isinstance(area, str) and area[:1].isalpha():
                    geom = shapely.from_wkt(area)
                elif wkb is not None:
                    geom = shapely.from_wkb(wkb)
                else:
                    continue
                parts.setdefault(pid, []).append(geom)
    for pid, geoms in parts.items():
        # Split into single polygons, repair (digitised boundaries often self-intersect)
        # and simplify each to ~100 m *before* merging: hundreds of detailed parcels
        # are far too slow to merge at full detail.
        pieces = []
        points = []
        def flatten(g):
            if hasattr(g, "geoms"):  # Multi* and GeometryCollection, possibly nested
                for sub in g.geoms:
                    yield from flatten(sub)
            else:
                yield g

        for x in geoms:
            for part in flatten(shapely.make_valid(x)):
                if part.geom_type == "Polygon":
                    pieces.append(part.simplify(0.001))
                elif part.geom_type == "Point":
                    points.append(part)
        if pieces:
            merged = unary_union([p for p in pieces if not p.is_empty])
            pt = merged.representative_point()
            # Display outline: close gaps under ~250 m between parcels, then simplify to ~150 m.
            simple = merged.buffer(0.0025, quad_segs=1).buffer(-0.002, quad_segs=1).simplify(0.0015)
        elif points:
            pt = unary_union(points).centroid
            simple = None
        else:
            continue
        out[pid] = {
            "lon": round(pt.x, 5),
            "lat": round(pt.y, 5),
            "geometry": mapping(simple) if simple is not None else None,
            "renoster_name": index[pid]["Project Name"],
            "approach": index[pid].get("Processing Approach"),
        }
    for v in out.values():
        if v["geometry"]:
            v["geometry"] = round_coords(v["geometry"])
    return out


def round_coords(geom):
    def r(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [round(c[0], 4), round(c[1], 4)]
        return [r(x) for x in c]

    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vrod", required=True, type=Path)
    ap.add_argument("--renoster", required=True, type=Path)
    ap.add_argument("--geonames", required=True, type=Path)
    ap.add_argument("--ne", required=True, type=Path)
    ap.add_argument("--curation", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--candidates", nargs="*", default=[], help="Print GeoNames candidates for these project IDs")
    args = ap.parse_args()

    cur = json.loads(args.curation.read_text(encoding="utf-8"))
    child_of = {c: p for p, kids in cur["groups"].items() for c in kids}

    wb = openpyxl.load_workbook(args.vrod, read_only=True)
    rows = {}
    for r in wb["PROJECTS"].iter_rows(min_row=5, max_col=17, values_only=True):
        pid, name, reg, _arb, status, _scope, typ, _rr, meth, _mver, _region, country, state, site, dev, issued, retired = r
        if not pid:
            continue
        if not (FILTER_METHOD.search(str(meth or "")) or FILTER_NAME.search(str(name or ""))):
            continue
        if pid in cur["exclude"]:
            continue
        rows[pid] = dict(
            id=pid, name=str(name).strip(), registry=REGISTRY_NAMES.get(reg, reg), status=status or "",
            methodology=meth if meth and meth not in ("None", "Not provided") else None,
            country=country, state=state, site=site, developer=dev,
            issued=int(issued or 0), retired=int(retired or 0),
        )

    # Fold programme sub-activities (Gold Standard VPAs) into their parent.
    for child, parent in child_of.items():
        if child in rows and parent in rows:
            c = rows.pop(child)
            p = rows[parent]
            p.setdefault("activities", []).append(c["id"])
            p["issued"] += c["issued"]
            p["retired"] += c["retired"]

    countries = load_countries(args.ne)
    admin1 = load_admin1(args.ne)
    renoster = load_renoster(args.renoster, set(rows))

    projects = []
    unresolved = []
    for pid, p in sorted(rows.items()):
        c = countries.get(COUNTRY_ALIASES.get(p["country"], "")) or countries.get(norm(p["country"] or ""))
        if not c:
            unresolved.append((pid, f"country {p['country']!r}"))
            continue
        loc = {"precision": "country", "lon": round(c["lon"], 4), "lat": round(c["lat"], 4), "basis": c["name"]}
        geometry = None
        rec = renoster.get(pid)
        spec = cur["locations"].get(pid)
        if rec:
            loc = {
                "precision": "boundary" if rec["geometry"] else "site",
                "lon": rec["lon"],
                "lat": rec["lat"],
                "basis": "Renoster project boundary database",
            }
            geometry = rec["geometry"]
        elif spec and "state" in spec:
            a1 = find_admin1(admin1, c["iso"], spec["state"])
            if a1:
                loc = {"precision": "state", "lon": round(a1["lon"], 4), "lat": round(a1["lat"], 4), "basis": f"{a1['name']} (Natural Earth)"}
            else:
                unresolved.append((pid, f"state {spec['state']!r}"))
        elif spec and ("place" in spec or "region" in spec):
            kind = "place" if "place" in spec else "region"
            query = spec[kind]
            area = find_admin1(admin1, c["iso"], spec["admin1"]) if spec.get("admin1") else None
            if spec.get("geonameid"):
                hit = gn_by_id(args.geonames, c["iso"], spec["geonameid"])
            else:
                hit = gn_lookup(args.geonames, c["iso"], query, kind, area)
            if args.candidates and pid in args.candidates:
                for cand in sorted(gn_candidates(args.geonames, c["iso"], query, kind), key=lambda x: -x["tier"])[:15]:
                    r = cand["row"]
                    print(f"    cand {pid}: tier{cand['tier']} id={r[0]} {r[1]} [{r[7]}] {r[4]},{r[5]} adm1={r[10]} pop={r[14]}")
            if hit:
                lon, lat, matched, code, gid = hit
                label = matched if norm(matched) == norm(query) else f"{query}, matched {matched}"
                loc = {"precision": "place", "lon": round(lon, 4), "lat": round(lat, 4), "basis": f"{label} (GeoNames {gid})"}
            elif area:
                # The place isn't in GeoNames inside the named state: fall back to the state.
                loc = {"precision": "state", "lon": round(area["lon"], 4), "lat": round(area["lat"], 4), "basis": f"{area['name']} (Natural Earth)"}
            else:
                unresolved.append((pid, f"{kind} {query!r}"))
        text = " ".join(filter(None, [p["name"], rec["renoster_name"] if rec else ""]))
        projects.append(
            {
                "id": pid,
                "name": p["name"],
                "registry": p["registry"],
                "url": registry_url(pid),
                "status": p["status"],
                "statusGroup": status_group(p["status"], p["issued"]),
                "ecosystem": ecosystem(text),
                "methodology": p["methodology"],
                "country": c["name"],
                "developer": p["developer"],
                "creditsIssued": p["issued"],
                "creditsRetired": p["retired"],
                **({"activities": p["activities"]} if p.get("activities") else {}),
                "location": loc,
                **({"boundary": geometry} if geometry else {}),
            }
        )

    out = {
        "generated": "from Berkeley VROD v2026-08",
        "count": len(projects),
        "sources": [
            {
                "name": "Voluntary Registry Offsets Database (v2026-08)",
                "by": "Berkeley Carbon Trading Project, Goldman School of Public Policy, UC Berkeley",
                "license": "CC BY 4.0",
                "url": "https://gspp.berkeley.edu/berkeley-carbon-trading-project/offsets-database",
            },
            {
                "name": "A global database of nature-based carbon offset project boundaries",
                "by": "Karnik, A., Kilbride, J., Goodbody, T., Ross, R., Ayrey, E. (2024)",
                "license": "CC BY 4.0",
                "url": "https://doi.org/10.5281/zenodo.11459391",
            },
            {"name": "GeoNames", "license": "CC BY 4.0", "url": "https://www.geonames.org/"},
            {"name": "Natural Earth", "license": "Public domain", "url": "https://www.naturalearthdata.com/"},
        ],
        "projects": projects,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    from collections import Counter

    print(f"{len(projects)} projects -> {args.out} ({args.out.stat().st_size / 1e3:.0f} kB)")
    print("precision:", dict(Counter(p["location"]["precision"] for p in projects)))
    print("registry:", dict(Counter(p["registry"] for p in projects)))
    print("status:", dict(Counter(p["statusGroup"] for p in projects)))
    print("ecosystem:", dict(Counter(p["ecosystem"] for p in projects)))
    for p in projects:
        l = p["location"]
        if l["precision"] in ("place", "state", "site", "boundary"):
            print(f"  {p['id']:9} {l['precision']:8} {l['lat']:8.3f},{l['lon']:9.3f}  {l['basis']}")
    if unresolved:
        print("UNRESOLVED (fell back to country):", unresolved, file=sys.stderr)


if __name__ == "__main__":
    main()
