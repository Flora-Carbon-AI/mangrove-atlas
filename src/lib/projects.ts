/**
 * Blue carbon projects, built from open data by pipeline/projects/build_projects.py.
 * Locations carry an explicit precision so the map never implies more than we know.
 */

export type Precision = "boundary" | "site" | "place" | "state" | "country";
export type StatusGroup = "issuing" | "registered" | "in development" | "inactive";

export interface Project {
  id: string;
  name: string;
  registry: string;
  url: string | null;
  status: string;
  statusGroup: StatusGroup;
  ecosystem: string;
  methodology: string | null;
  country: string;
  developer: string | null;
  creditsIssued: number;
  creditsRetired: number;
  activities?: string[];
  location: { precision: Precision; lon: number; lat: number; basis: string };
  boundary?: GeoJSON.Geometry;
}

export interface ProjectsData {
  generated: string;
  count: number;
  sources: { name: string; by?: string; license: string; url: string }[];
  projects: Project[];
}

export const PROJECTS_URL = "/projects/blue-carbon-projects.json";

let cached: Promise<ProjectsData> | null = null;
export function loadProjects(): Promise<ProjectsData> {
  cached ??= fetch(PROJECTS_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Projects unavailable (${r.status})`);
      return r.json() as Promise<ProjectsData>;
    })
    .catch((err) => {
      cached = null;
      throw err;
    });
  return cached;
}

export const PRECISION_LABEL: Record<Precision, string> = {
  boundary: "Project boundary",
  site: "Project site",
  place: "Approximate: place named in the project title",
  state: "Approximate: state or province",
  country: "Country only: site not in open data",
};

export const STATUS_LABEL: Record<StatusGroup, string> = {
  issuing: "Issuing credits",
  registered: "Registered",
  "in development": "In development",
  inactive: "Withdrawn, rejected or inactive",
};
