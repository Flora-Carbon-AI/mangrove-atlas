"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BASEMAPS, COLORS, DATASET_ORDER, DATASETS, PLACES, type Basemap, type BBox, type DatasetId } from "@/lib/datasets";
import { bboxAreaKm2, formatArea } from "@/lib/geo";
import type { LayersResponse, PointResponse, StatsResponse, StatusResponse } from "@/lib/types";
import AreaChart from "./AreaChart";
import type { FlyTarget } from "./MapView";
import Timeline from "./Timeline";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

type Mode = "extent" | "change" | "compare";

const REPO_URL = "https://github.com/Flora-Carbon-AI/mangrove-atlas";

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

function useLayers(dataset: DatasetId, year: number | null, mode: "extent" | "change", base: number | null) {
  let query: string | null = null;
  if (year !== null) {
    const q = new URLSearchParams({ dataset, year: String(year), mode });
    if (mode === "change" && base !== null) q.set("base", String(base));
    query = q.toString();
  }
  const [state, setState] = useState<{ query: string | null; data: LayersResponse | null; error: string | null }>({
    query: null,
    data: null,
    error: null,
  });
  useEffect(() => {
    if (query === null) return;
    const ctl = new AbortController();
    getJson<LayersResponse>(`/api/layers?${query}`, ctl.signal)
      .then((data) => setState({ query, data, error: null }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ query, data: null, error: e.message });
      });
    return () => ctl.abort();
  }, [query]);
  if (query === null) return { data: null, error: null, loading: false };
  const settled = state.query === query;
  // Keep showing the previous year while the next one loads, so a timelapse doesn't flash.
  return { data: state.data, error: settled ? state.error : null, loading: !settled };
}

export default function Atlas() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [datasetId, setDatasetId] = useState<DatasetId>("esa-cci-lc");
  const ds = DATASETS[datasetId];
  const [year, setYear] = useState<number>(ds.years[ds.years.length - 1]);
  const [base, setBase] = useState<number>(ds.years[0]);
  const [mode, setMode] = useState<Mode>("extent");
  const [opacity, setOpacity] = useState(0.9);
  const [basemap, setBasemap] = useState<Basemap>("satellite");
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<{ bbox: BBox; zoom: number } | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsState, setStatsState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [point, setPoint] = useState<PointResponse | null>(null);
  const [pointState, setPointState] = useState<{ loading: boolean; error: string | null; at: [number, number] | null }>({
    loading: false,
    error: null,
    at: null,
  });
  const [fly, setFly] = useState<FlyTarget | null>(null);
  // null = layout default: open on desktop, closed on phones (decided in CSS).
  const [panelOpen, setPanelOpen] = useState<boolean | null>(null);

  const geeReady = status?.gee.ok === true;

  const jumpTo = (center: [number, number], zoom: number) => {
    setFly((f) => ({ center, zoom, key: (f?.key ?? 0) + 1 }));
    // On phones the panel covers the map; get out of the way.
    if (window.matchMedia("(max-width: 860px)").matches) setPanelOpen(false);
  };

  const selectDataset = useCallback((id: DatasetId) => {
    const next = DATASETS[id];
    setDatasetId(id);
    setYear((y) => (next.years.includes(y) ? y : next.years[next.years.length - 1]));
    setBase(next.years[0]);
    setMode((m) => (m === "change" && !next.supportsChange ? "extent" : m));
    setStats(null);
    setPoint(null);
    setStatsState({ loading: false, error: null });
    setPointState((p) => ({ ...p, error: null }));
    setPlaying(false);
  }, []);

  // Earth Engine status decides which dataset we open with.
  useEffect(() => {
    getJson<StatusResponse>("/api/status")
      .then((s) => {
        setStatus(s);
        // With Earth Engine, open on the longest and most recent record (1984–2023).
        if (s.gee.ok) selectDataset("cgmd-30");
      })
      .catch(() => setStatus({ gee: { configured: false, ok: false } }));
  }, [selectDataset]);

  const changeView = mode === "change" && ds.supportsChange;
  const primary = useLayers(datasetId, year, changeView ? "change" : "extent", changeView ? base : null);
  const secondary = useLayers(datasetId, mode === "compare" ? base : null, "extent", null);

  /** Moves to a year; when comparing, the base year steps aside if they collide. */
  const goToYear = useCallback(
    (y: number) => {
      setYear(y);
      if (y === base && mode !== "extent") {
        const other = ds.years.find((v) => v !== y);
        if (other !== undefined) setBase(other);
      }
    },
    [base, mode, ds.years],
  );

  // Timelapse: advance once the current year has loaded, at a readable pace.
  useEffect(() => {
    if (!playing || primary.loading) return;
    const t = setTimeout(() => {
      const i = ds.years.indexOf(year);
      let next = ds.years[(i + 1) % ds.years.length];
      // Skip the comparison year so the two sides never show the same year.
      if (mode !== "extent" && next === base) next = ds.years[(i + 2) % ds.years.length];
      setYear(next);
    }, 1500);
    return () => clearTimeout(t);
  }, [playing, primary.loading, year, ds.years, mode, base]);

  const measure = useCallback(() => {
    if (!view) return;
    setStatsState({ loading: true, error: null });
    getJson<StatsResponse>(`/api/stats?dataset=${datasetId}&bbox=${view.bbox.map((v) => v.toFixed(4)).join(",")}`)
      .then((s) => {
        setStats(s);
        setStatsState({ loading: false, error: null });
      })
      .catch((e: Error) => setStatsState({ loading: false, error: e.message }));
  }, [view, datasetId]);

  const inspect = useCallback(
    (lon: number, lat: number) => {
      setPointState({ loading: true, error: null, at: [lon, lat] });
      getJson<PointResponse>(`/api/point?dataset=${datasetId}&lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}`)
        .then((p) => {
          setPoint(p);
          setPointState({ loading: false, error: null, at: [lon, lat] });
        })
        .catch((e: Error) => setPointState({ loading: false, error: e.message, at: [lon, lat] }));
    },
    [datasetId],
  );

  const onView = useCallback((bbox: BBox, zoom: number) => setView({ bbox, zoom }), []);

  const viewSpan = view ? Math.max(view.bbox[2] - view.bbox[0], view.bbox[3] - view.bbox[1]) : Infinity;
  const tooWide = viewSpan > ds.maxStatsSpanDeg;
  const belowMinZoom = view !== null && view.zoom < ds.minZoom;
  const statsStale = stats !== null && view !== null && stats.bbox.join() !== view.bbox.map((v) => +v.toFixed(4)).join();

  const change = useMemo(() => {
    if (!stats) return null;
    const a = stats.years[0];
    const b = stats.years[stats.years.length - 1];
    if (a.areaKm2 <= 0) return null;
    return { from: a, to: b, pct: ((b.areaKm2 - a.areaKm2) / a.areaKm2) * 100 };
  }, [stats]);

  const pointSummary = useMemo(() => {
    if (!point) return null;
    const present = point.years.filter((y) => y.present).map((y) => y.year);
    if (present.length === 0) return `Not mapped as mangrove in any year of ${ds.name}.`;
    if (present.length === point.years.length) return `Mangrove in every year on record.`;
    return `Mangrove in ${present.length} of ${point.years.length} years, first in ${present[0]}, last in ${present[present.length - 1]}.`;
  }, [point, ds.name]);

  const layerError = primary.error ?? secondary.error;

  return (
    <main className="atlas">
      <MapView
        primary={primary.data}
        secondary={mode === "compare" ? secondary.data : null}
        compare={mode === "compare"}
        compareLabels={[String(base), String(year)]}
        basemap={basemap}
        opacity={opacity}
        marker={pointState.at}
        flyTo={fly}
        onPick={inspect}
        onView={onView}
      />

      <button
        type="button"
        className="panel-toggle"
        onClick={() => setPanelOpen((o) => !o)}
        aria-expanded={panelOpen === true}
        aria-controls="panel"
      >
        {panelOpen ? "Hide panel" : "Layers & data"}
      </button>

      <aside id="panel" className="panel" data-open={panelOpen === true || undefined}>
        <header className="brand">
          <h1>Mangrove Atlas</h1>
          <p>
            Where mangroves grew, year by year. An open-source tool from{" "}
            <a href="https://floracarbon.ai" target="_blank" rel="noreferrer">Flora Carbon AI</a>.
          </p>
        </header>

        <section aria-labelledby="h-data">
          <h2 id="h-data">Data</h2>
          <div className="datasets" role="radiogroup" aria-labelledby="h-data">
            {DATASET_ORDER.map((id) => {
              const d = DATASETS[id];
              const locked = d.provider === "gee" && !geeReady;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={id === datasetId}
                  disabled={locked}
                  className="dataset"
                  onClick={() => selectDataset(id)}
                >
                  <span className="dataset-name">{d.name}</span>
                  <span className="dataset-meta">
                    {d.years[0]}–{d.years[d.years.length - 1]}, {d.resolution},{" "}
                    {d.provider === "gee" ? "Google Earth Engine" : "Planetary Computer"}
                  </span>
                  {locked && (
                    <span className="dataset-lock">
                      {status === null
                        ? "Checking Earth Engine…"
                        : status.gee.configured
                          ? (status.gee.error ?? "Earth Engine is unavailable.")
                          : "Add an Earth Engine service account to turn this on. The README shows how."}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="note">{ds.summary}</p>
        </section>

        <section aria-labelledby="h-view">
          <h2 id="h-view">View</h2>
          <div className="segmented" role="tablist" aria-labelledby="h-view">
            {(["extent", "change", "compare"] as Mode[]).map((m) => {
              const disabled = m === "change" && !ds.supportsChange;
              return (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  disabled={disabled}
                  title={disabled ? "Gain and loss need an Earth Engine dataset" : undefined}
                  onClick={() => setMode(m)}
                >
                  {m === "extent" ? "Extent" : m === "change" ? "Gain & loss" : "Swipe"}
                </button>
              );
            })}
          </div>
          {mode !== "extent" && (
            <label className="field">
              <span>{mode === "change" ? "Change since" : "Left side shows"}</span>
              <select value={base} onChange={(e) => setBase(Number(e.target.value))}>
                {ds.years.filter((y) => y !== year).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </label>
          )}
          <div className="field">
            <span id="basemap-label">Background map</span>
            <div className="segmented" role="radiogroup" aria-labelledby="basemap-label">
              {BASEMAPS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={basemap === b.id}
                  onClick={() => setBasemap(b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Layer opacity</span>
            <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
          <ul className="legend">
            {changeView ? (
              <>
                <li><i style={{ background: COLORS.gain }} />Gained since {base}</li>
                <li><i style={{ background: COLORS.loss }} />Lost since {base}</li>
              </>
            ) : (
              <li><i style={{ background: COLORS.mangrove }} />Mangrove in {year}{mode === "compare" ? ` (left: ${base})` : ""}</li>
            )}
          </ul>
          {belowMinZoom && <p className="note">Zoom in to see {ds.name}. It only renders from zoom level {ds.minZoom}.</p>}
          {!belowMinZoom && view !== null && view.zoom < 6 && ds.provider === "mpc" && (
            <p className="note">
              Zoomed this far out, small mangrove patches are smaller than one screen pixel and drop out. Zoom in, or
              use the Dark map for more contrast.
            </p>
          )}
          {layerError && <p className="error">Map layer did not load: {layerError}</p>}
        </section>

        <section aria-labelledby="h-area">
          <h2 id="h-area">Area in this view</h2>
          {tooWide ? (
            <p className="note">
              Zoom in to measure. The view must be under {ds.maxStatsSpanDeg}° across for {ds.name}.
            </p>
          ) : (
            <button type="button" className="primary" onClick={measure} disabled={statsState.loading || !view}>
              {statsState.loading ? "Measuring every year…" : stats && !statsStale ? "Measure again" : "Measure mangroves in view"}
            </button>
          )}
          {statsState.error && <p className="error">{statsState.error}</p>}
          {stats && (
            <div className={statsStale ? "is-stale" : undefined}>
              <AreaChart data={stats.years} selected={year} onSelect={setYear} />
              {change && (
                <p className="note">
                  {change.pct >= 0 ? "Up" : "Down"} {Math.abs(change.pct).toFixed(1)}% from {change.from.year} to {change.to.year}, across{" "}
                  {formatArea(stats.regionKm2)} of map.
                </p>
              )}
              {statsStale && <p className="note">The map has moved since this was measured.</p>}
            </div>
          )}
        </section>

        <section aria-labelledby="h-point">
          <h2 id="h-point">Point history</h2>
          {!pointState.at && <p className="note">Click anywhere on the map to see which years it was mangrove.</p>}
          {pointState.at && (
            <>
              <p className="coords">
                {pointState.at[1].toFixed(4)}°, {pointState.at[0].toFixed(4)}°
              </p>
              {pointState.loading && <p className="note">Reading every year at this point…</p>}
              {pointState.error && <p className="error">{pointState.error}</p>}
              {point && !pointState.loading && (
                <>
                  <ol className="history">
                    {point.years.map((y) => (
                      <li
                        key={y.year}
                        data-state={y.present === null ? "none" : y.present ? "yes" : "no"}
                        title={`${y.year}: ${y.present === null ? "no data" : y.present ? "mangrove" : "not mangrove"}`}
                      >
                        <button type="button" onClick={() => setYear(y.year)} aria-label={`${y.year}, ${y.present === null ? "no data" : y.present ? "mangrove" : "not mangrove"}`}>
                          <i />
                          <span>{String(y.year).slice(2)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  <p className="note">{pointSummary}</p>
                </>
              )}
            </>
          )}
        </section>

        <section aria-labelledby="h-places">
          <h2 id="h-places">Go to</h2>
          <ul className="places">
            {PLACES.map((p) => (
              <li key={p.name}>
                <button type="button" onClick={() => jumpTo(p.center, p.zoom)}>
                  {p.name}
                  <span>{p.country}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <footer className="sources">
          <p>{ds.citation}</p>
          <p>
            Licence: {ds.license}. <a href={ds.sourceUrl} target="_blank" rel="noreferrer">Dataset source</a>
          </p>
          <p>
            Mangrove Atlas is MIT licensed. <a href={REPO_URL} target="_blank" rel="noreferrer">Code on GitHub</a>
          </p>
          {view && (
            <p className="muted">
              View: {formatArea(bboxAreaKm2(view.bbox))}, zoom {view.zoom.toFixed(1)}
            </p>
          )}
        </footer>
      </aside>

      <div className="timeline-dock">
        <Timeline
          years={ds.years}
          year={year}
          base={mode === "extent" ? null : base}
          playing={playing}
          loading={primary.loading || secondary.loading}
          onYear={goToYear}
          onTogglePlay={() => setPlaying((p) => !p)}
        />
      </div>
    </main>
  );
}
