/**
 * Daily satellite images from NASA's Global Imagery Browse Services (GIBS).
 * Public WMTS tiles, no key or account: https://nasa-gibs.github.io/gibs-api-docs/
 *
 * Each satellite images the whole Earth about once a day. Pixels are a few
 * hundred metres across, so this shows clouds, floods, river plumes and large
 * clearings, not individual mangrove stands.
 */

export type DailySensor = "terra" | "aqua" | "noaa20";
export type DailyBands = "true" | "false";

export interface DailySettings {
  sensor: DailySensor;
  bands: DailyBands;
  /** UTC day, YYYY-MM-DD. */
  date: string;
}

export const DAILY_SENSORS: Record<
  DailySensor,
  { label: string; detail: string; first: string; layers: Record<DailyBands, string> }
> = {
  terra: {
    label: "Terra MODIS",
    detail: "morning, from 2000",
    first: "2000-02-24",
    layers: { true: "MODIS_Terra_CorrectedReflectance_TrueColor", false: "MODIS_Terra_CorrectedReflectance_Bands721" },
  },
  aqua: {
    label: "Aqua MODIS",
    detail: "afternoon, from 2002",
    first: "2002-07-03",
    layers: { true: "MODIS_Aqua_CorrectedReflectance_TrueColor", false: "MODIS_Aqua_CorrectedReflectance_Bands721" },
  },
  noaa20: {
    label: "NOAA-20 VIIRS",
    detail: "afternoon, from 2018",
    first: "2018-01-05",
    layers: {
      true: "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
      false: "VIIRS_NOAA20_CorrectedReflectance_BandsM11-I2-I1",
    },
  },
};

export const DAILY_SENSOR_IDS = Object.keys(DAILY_SENSORS) as DailySensor[];

/** Today in UTC: the newest image, which fills in as the day's passes arrive. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Keeps a date inside what the satellite has imaged. */
export function clampDate(date: string, sensor: DailySensor, max: string): string {
  const first = DAILY_SENSORS[sensor].first;
  return date < first ? first : date > max ? max : date;
}

const formatDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Tile URL and on-map credit for one day's image. */
export function dailyLayer(s: DailySettings): { tiles: string; attribution: string } {
  const layer = DAILY_SENSORS[s.sensor].layers[s.bands];
  return {
    tiles: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${s.date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    attribution: `${DAILY_SENSORS[s.sensor].label}, ${formatDay(s.date)}: NASA GIBS`,
  };
}
