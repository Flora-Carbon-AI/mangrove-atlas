"use client";

import {
  addDays,
  clampDate,
  DAILY_SENSOR_IDS,
  DAILY_SENSORS,
  type DailyBands,
  type DailySensor,
  type DailySettings,
} from "@/lib/daily";

interface Props {
  /** null while the image is off. */
  settings: DailySettings | null;
  /** Newest date with an image (today, UTC); set when the image is turned on. */
  maxDate: string;
  onToggle: (on: boolean) => void;
  onChange: (s: DailySettings) => void;
}

const BANDS: { id: DailyBands; label: string }[] = [
  { id: "true", label: "True colour" },
  { id: "false", label: "False colour" },
];

/** Panel section: one day's NASA satellite image, by date, satellite and colours. */
export default function DailyImagerySection({ settings, maxDate, onToggle, onChange }: Props) {
  const set = (patch: Partial<DailySettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    onChange({ ...next, date: clampDate(next.date, next.sensor, maxDate) });
  };

  return (
    <section aria-labelledby="h-daily">
      <h2 id="h-daily">Daily satellite image</h2>
      <label className="check">
        <input type="checkbox" checked={settings !== null} onChange={(e) => onToggle(e.target.checked)} />
        Show NASA&apos;s image for one day
      </label>
      {settings && (
        <>
          <div className="field">
            <label htmlFor="daily-date">Date (UTC)</label>
            <div className="field-row date-row">
              <button
                type="button"
                aria-label="Previous day"
                disabled={settings.date <= DAILY_SENSORS[settings.sensor].first}
                onClick={() => set({ date: addDays(settings.date, -1) })}
              >
                ‹
              </button>
              <input
                id="daily-date"
                type="date"
                min={DAILY_SENSORS[settings.sensor].first}
                max={maxDate}
                value={settings.date}
                onChange={(e) => {
                  if (e.target.value) set({ date: e.target.value });
                }}
              />
              <button
                type="button"
                aria-label="Next day"
                disabled={settings.date >= maxDate}
                onClick={() => set({ date: addDays(settings.date, 1) })}
              >
                ›
              </button>
            </div>
          </div>
          <label className="field">
            <span>Satellite</span>
            <select value={settings.sensor} onChange={(e) => set({ sensor: e.target.value as DailySensor })}>
              {DAILY_SENSOR_IDS.map((id) => (
                <option key={id} value={id}>
                  {DAILY_SENSORS[id].label} ({DAILY_SENSORS[id].detail})
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span id="daily-bands-label">Colours</span>
            <div className="segmented segmented-2" role="radiogroup" aria-labelledby="daily-bands-label">
              {BANDS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={settings.bands === b.id}
                  onClick={() => set({ bands: b.id })}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <p className="note">
            {settings.bands === "false"
              ? "False colour separates water from land: water is dark blue to black, vegetation green, bare ground pink or tan, and cloud white or cyan. "
              : ""}
            Pixels are a few hundred metres across: good for clouds, floods, river plumes and large clearings, too
            coarse for single mangrove stands. Black areas are gaps between satellite passes; try another day, or VIIRS,
            which has the fewest gaps. Today&apos;s image fills in during the day.
          </p>
          <p className="note">
            We acknowledge the use of imagery provided by services from NASA&apos;s{" "}
            <a href="https://nasa-gibs.github.io/gibs-api-docs/" target="_blank" rel="noreferrer">
              Global Imagery Browse Services (GIBS)
            </a>
            , part of NASA&apos;s Earth Science Data and Information System (ESDIS).
          </p>
        </>
      )}
    </section>
  );
}
