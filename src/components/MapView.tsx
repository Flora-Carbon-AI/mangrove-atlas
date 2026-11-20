"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AttributionControl, Map as MLMap, Marker, NavigationControl, ScaleControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Copied into /public by scripts/copy-maplibre-worker.mjs (runs before dev and build).
setWorkerUrl("/vendor/maplibre-gl-worker.mjs");
import type { Basemap, BBox } from "@/lib/datasets";
import type { LayersResponse } from "@/lib/types";
import { applyOverlay, basemapStyle, setOverlayOpacity, switchBasemap } from "./mapStyle";

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
  const { primary, secondary, compare, compareLabels, basemap, opacity, marker, flyTo, onPick, onView } = props;
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
  const handlers = useRef({ onPick, onView });
  useEffect(() => {
    handlers.current = { onPick, onView };
  }, [onPick, onView]);

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
    map.on("click", (e) => handlers.current.onPick(e.lngLat.lng, e.lngLat.lat));
    mapRef.current = map;
    return () => {
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
    top.on("click", (e) => handlers.current.onPick(e.lngLat.lng, e.lngLat.lat));
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
