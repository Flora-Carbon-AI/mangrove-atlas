"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addProtocol,
  AttributionControl,
  Map as MLMap,
  Marker,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { gmwProtocol } from "@/lib/gmw";

// Copied into /public by scripts/copy-maplibre-worker.mjs (runs before dev and build).
setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
// Global Mangrove Watch tiles are decoded and coloured in the browser.
addProtocol("gmw", gmwProtocol);
import type { Basemap, BBox } from "@/lib/datasets";
import type { LayersResponse } from "@/lib/types";
import { applyDaily, applyOverlay, basemapStyle, setOverlayOpacity, switchBasemap } from "./mapStyle";
import { applyProjects, PROJECT_CLICK_LAYERS, type ProjectFeatures } from "./projectsLayer";

/** One project, several whose markers overlap, or a country's country-only projects. */
export type ProjectPick = { id: string } | { ids: string[] } | { country: string };

/** Clicks on a project marker open the project; anywhere else reads the point history. */
function wireClicks(
  map: MLMap,
  handlers: { current: { onPick: (lon: number, lat: number) => void; onProjectPick: (p: ProjectPick) => void } },
) {
  // A box around the tap, not a single pixel, so small markers are easy to hit with a finger.
  const pad = window.matchMedia("(pointer: coarse)").matches ? 14 : 6;
  const hit = (point: { x: number; y: number }) => {
    const layers = PROJECT_CLICK_LAYERS.filter((id) => map.getLayer(id));
    if (!layers.length) return [];
    return map.queryRenderedFeatures(
      [
        [point.x - pad, point.y - pad],
        [point.x + pad, point.y + pad],
      ],
      { layers },
    );
  };
  map.on("click", (e) => {
    const hits = hit(e.point);
    // Projects that name the same place share a marker position: offer all of them.
    const ids = [...new Set(hits.map((f) => f.properties?.id).filter(Boolean).map(String))];
    const country = hits.find((f) => f.properties?.country)?.properties?.country;
    if (ids.length === 1) handlers.current.onProjectPick({ id: ids[0] });
    else if (ids.length > 1) handlers.current.onProjectPick({ ids });
    else if (country) handlers.current.onProjectPick({ country: String(country) });
    else handlers.current.onPick(e.lngLat.lng, e.lngLat.lat);
  });
  map.on("mousemove", (e) => {
    map.getCanvas().style.cursor = hit(e.point).length ? "pointer" : "";
  });
}

export interface FlyTarget {
  center: [number, number];
  zoom: number;
  key: number;
}

interface Props {
  /** Overlay for the whole map (right side when comparing). */
  primary: LayersResponse | null;
  /** Overlay for the left side of the swipe when comparing. */
  secondary: LayersResponse | null;
  compare: boolean;
  compareLabels: [string, string];
  basemap: Basemap;
  opacity: number;
  marker: [number, number] | null;
  flyTo: FlyTarget | null;
  onPick: (lon: number, lat: number) => void;
  onView: (bbox: BBox, zoom: number) => void;
  /** Blue carbon project markers, or null to hide them. */
  projects: ProjectFeatures | null;
  onProjectPick: (pick: ProjectPick) => void;
  /** One day's satellite image under the overlay, or null for none. */
  daily: { tiles: string; attribution: string } | null;
}

const INITIAL = { center: [89.25, 21.95] as [number, number], zoom: 8.6 };

// isStyleLoaded() turns false again while sources fetch tiles, so track
// readiness ourselves: a map is ready after "style.load" until its next setStyle.
const readyMaps = new WeakSet<MLMap>();
const mapBasemap = new WeakMap<MLMap, Basemap>();

function trackStyle(map: MLMap, basemap: Basemap) {
  mapBasemap.set(map, basemap);
  map.on("style.load", () => readyMaps.add(map));
}

function whenReady(map: MLMap, fn: () => void) {
  if (readyMaps.has(map)) fn();
  else map.once("style.load", fn);
}

function setBasemap(map: MLMap, basemap: Basemap) {
  if (mapBasemap.get(map) === basemap) return;
  mapBasemap.set(map, basemap);
  readyMaps.delete(map);
  switchBasemap(map, basemap);
}

export default function MapView(props: Props) {
  const {
    primary,
    secondary,
    compare,
    compareLabels,
    basemap,
    opacity,
    marker,
    flyTo,
    onPick,
    onView,
    projects,
    onProjectPick,
    daily,
  } = props;
  const basemapRef = useRef(basemap);
  useEffect(() => {
    basemapRef.current = basemap;
  }, [basemap]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const topMapRef = useRef<MLMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [split, setSplit] = useState(0.5);
  const handlers = useRef({ onPick, onView, onProjectPick });
  useEffect(() => {
    handlers.current = { onPick, onView, onProjectPick };
  }, [onPick, onView, onProjectPick]);

  // Main map, created once.
  useEffect(() => {
    if (!baseRef.current) return;
    const map = new MLMap({
      container: baseRef.current,
      style: basemapStyle(basemapRef.current),
      center: INITIAL.center,
      zoom: INITIAL.zoom,
      attributionControl: false,
      maxPitch: 0,
      dragRotate: false,
    });
    trackStyle(map, basemapRef.current);
    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    const report = () => {
      const b = map.getBounds();
      handlers.current.onView(
        [
          Math.max(-180, b.getWest()),
          Math.max(-85, b.getSouth()),
          Math.min(180, b.getEast()),
          Math.min(85, b.getNorth()),
        ],
        map.getZoom(),
      );
    };
    map.on("moveend", report);
    map.once("load", report);
    // On phones the expanded attribution covers a third of the map. MapLibre opens it the
    // first time any attribution appears (often after "load"), so close it at that moment,
    // as MapLibre itself does on the first drag. The (i) button still opens it.
    if (window.matchMedia("(max-width: 860px)").matches) {
      const attrib = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
      const collapse = () => {
        if (!attrib?.classList.contains("maplibregl-compact-show")) return;
        attrib.classList.remove("maplibregl-compact-show");
        map.off("styledata", collapse);
        map.off("sourcedata", collapse);
      };
      map.on("styledata", collapse);
      map.on("sourcedata", collapse);
    }
    wireClicks(map, handlers);
    mapRef.current = map;
    // Development only: lets tests ask the map where things are (window.__atlasMap).
    const debug = window as unknown as { __atlasMap?: MLMap };
    if (process.env.NODE_ENV === "development") debug.__atlasMap = map;
    return () => {
      if (debug.__atlasMap === map) delete debug.__atlasMap;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Primary overlay.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(map, () => applyOverlay(map, primary, opacity));
    // opacity changes are handled separately to avoid re-adding sources
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary]);

  // Comparison map: created on demand and kept in lockstep with the main map.
  useEffect(() => {
    const base = mapRef.current;
    if (!compare || !base || !topRef.current) return;
    const top = new MLMap({
      container: topRef.current,
      style: basemapStyle(basemapRef.current),
      center: base.getCenter(),
      zoom: base.getZoom(),
      attributionControl: false,
      maxPitch: 0,
      dragRotate: false,
    });
    trackStyle(top, basemapRef.current);
    top.touchZoomRotate.disableRotation();
    let syncing = false;
    const mirror = (from: MLMap, to: MLMap) => () => {
      if (syncing) return;
      syncing = true;
      to.jumpTo({ center: from.getCenter(), zoom: from.getZoom() });
      syncing = false;
    };
    const a = mirror(base, top);
    const b = mirror(top, base);
    base.on("move", a);
    top.on("move", b);
    top.on("moveend", () => base.fire("moveend"));
    wireClicks(top, handlers);
    topMapRef.current = top;
    return () => {
      base.off("move", a);
      top.remove();
      topMapRef.current = null;
    };
  }, [compare]);

  useEffect(() => {
    const top = topMapRef.current;
    if (!top) return;
    whenReady(top, () => applyOverlay(top, secondary, opacity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondary, compare]);

  useEffect(() => {
    for (const m of [mapRef.current, topMapRef.current]) {
      if (m) whenReady(m, () => setOverlayOpacity(m, opacity));
    }
  }, [opacity]);

  // Blue carbon projects on both maps (the swipe map too).
  useEffect(() => {
    for (const m of [mapRef.current, topMapRef.current]) {
      if (m) whenReady(m, () => applyProjects(m, projects));
    }
  }, [projects, compare]);

  // Daily satellite image on both maps.
  useEffect(() => {
    for (const m of [mapRef.current, topMapRef.current]) {
      if (m) whenReady(m, () => applyDaily(m, daily));
    }
  }, [daily, compare]);

  useEffect(() => {
    for (const m of [mapRef.current, topMapRef.current]) {
      if (m) setBasemap(m, basemap);
    }
  }, [basemap]);

  useEffect(() => {
    if (flyTo) mapRef.current?.flyTo({ center: flyTo.center, zoom: flyTo.zoom, duration: 2200, essential: true });
  }, [flyTo]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!marker) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const el = document.createElement("div");
      el.className = "pick-marker";
      markerRef.current = new Marker({ element: el });
    }
    markerRef.current.setLngLat(marker).addTo(map);
  }, [marker]);

  // Swipe handle.
  const drag = useCallback((clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSplit(Math.min(0.95, Math.max(0.05, (clientX - rect.left) / rect.width)));
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const pct = `${(split * 100).toFixed(2)}%`;

  return (
    <div ref={wrapRef} className="map-fill">
      <div ref={baseRef} className="map-fill" />
      {compare && (
        <>
          <div
            ref={topRef}
            className="map-fill"
            style={{ clipPath: `inset(0 calc(100% - ${pct}) 0 0)` }}
          />
          <div className="swipe-label" style={{ right: `calc(100% - ${pct} + 12px)` }}>
            {compareLabels[0]}
          </div>
          <div className="swipe-label" style={{ left: `calc(${pct} + 12px)` }}>
            {compareLabels[1]}
          </div>
          <div
            role="slider"
            aria-label="Compare position"
            aria-valuemin={5}
            aria-valuemax={95}
            aria-valuenow={Math.round(split * 100)}
            tabIndex={0}
            className="swipe-handle"
            style={{ left: pct }}
            onPointerDown={startDrag}
            onPointerMove={(e) => {
              if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) drag(e.clientX);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setSplit((s) => Math.max(0.05, s - 0.02));
              if (e.key === "ArrowRight") setSplit((s) => Math.min(0.95, s + 0.02));
            }}
          >
            <span />
          </div>
        </>
      )}
    </div>
  );
}
