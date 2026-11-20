"use client";

import { PRECISION_LABEL, STATUS_LABEL, type Project, type ProjectsData } from "@/lib/projects";
import type { ProjectPick } from "./MapView";

const fmt = (n: number) => n.toLocaleString("en-US");

interface SectionProps {
  data: ProjectsData | null;
  error: string | null;
  show: boolean;
  onShow: (v: boolean) => void;
  includeInactive: boolean;
  onIncludeInactive: (v: boolean) => void;
  visible: Project[];
}

/** Panel section: toggle, counts, legend, coverage and sources. */
export function ProjectsSection({ data, error, show, onShow, includeInactive, onIncludeInactive, visible }: SectionProps) {
  const registries = [...new Set(visible.map((p) => p.registry))].sort();
  return (
    <section aria-labelledby="h-projects">
      <h2 id="h-projects">Blue carbon projects</h2>
      <label className="check">
        <input type="checkbox" checked={show} onChange={(e) => onShow(e.target.checked)} />
        Show projects on the map
      </label>
      <label className="check">
        <input type="checkbox" checked={includeInactive} onChange={(e) => onIncludeInactive(e.target.checked)} />
        Include withdrawn, rejected and inactive projects
      </label>
      {error && <p className="error">Projects didn&apos;t load: {error}</p>}
      {data && (
        <>
          <p className="note">
            {visible.length} projects across {registries.join(", ")}. Click a marker for details.
          </p>
          <ul className="project-legend">
            <li>
              <i className="pl-exact" aria-hidden="true" />
              Mapped site or boundary
            </li>
            <li>
              <i className="pl-approx" aria-hidden="true" />
              Approximate: place or state named by the project
            </li>
            <li>
              <i className="pl-country" aria-hidden="true">3</i>
              Country only: open data doesn&apos;t give the site
            </li>
          </ul>
          <p className="note">
            Built from open data, so registries whose data isn&apos;t openly licensed (such as Plan Vivo) aren&apos;t
            included yet. Sources:{" "}
            {data.sources.slice(0, 2).map((s, i) => (
              <span key={s.url}>
                {i > 0 && "; "}
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>{" "}
                ({s.license})
              </span>
            ))}
            .
          </p>
        </>
      )}
    </section>
  );
}

interface CardProps {
  pick: ProjectPick;
  data: ProjectsData;
  visible: Project[];
  onClose: () => void;
  onSelect: (id: string) => void;
  onZoom: (p: Project) => void;
}

/** Floating card for a selected project, or for the country-only projects of a country. */
export function ProjectCard({ pick, data, visible, onClose, onSelect, onZoom }: CardProps) {
  if ("country" in pick) {
    const list = visible.filter((p) => p.country === pick.country && p.location.precision === "country");
    return (
      <div className="project-card" role="dialog" aria-label={`Projects in ${pick.country}`}>
        <button type="button" className="card-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2>{pick.country}</h2>
        <p className="note">
          {list.length} project{list.length === 1 ? "" : "s"} whose exact site isn&apos;t in open data. The marker sits at
          the country&apos;s centre.
        </p>
        <ul className="project-list">
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onSelect(p.id)}>
                {p.name}
                <span>
                  {p.registry} {p.id}, {STATUS_LABEL[p.statusGroup].toLowerCase()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const p = data.projects.find((x) => x.id === pick.id);
  if (!p) return null;
  return (
    <div className="project-card" role="dialog" aria-label={p.name}>
      <button type="button" className="card-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <p className="card-kicker">
        {p.registry} {p.id}
      </p>
      <h2>{p.name}</h2>
      <dl>
        <dt>Status</dt>
        <dd>
          {STATUS_LABEL[p.statusGroup]}
          {p.status && p.status !== STATUS_LABEL[p.statusGroup] ? <span className="muted"> ({p.status})</span> : null}
        </dd>
        <dt>Ecosystem</dt>
        <dd>{p.ecosystem}</dd>
        <dt>Country</dt>
        <dd>{p.country}</dd>
        {p.developer && (
          <>
            <dt>Developer</dt>
            <dd>{p.developer}</dd>
          </>
        )}
        {p.methodology && (
          <>
            <dt>Method</dt>
            <dd>{p.methodology}</dd>
          </>
        )}
        <dt>Credits issued</dt>
        <dd>
          {fmt(p.creditsIssued)}
          {p.creditsRetired > 0 && <span className="muted">, {fmt(p.creditsRetired)} retired</span>}
        </dd>
        {p.activities && (
          <>
            <dt>Includes</dt>
            <dd>{p.activities.join(", ")}</dd>
          </>
        )}
        <dt>Location</dt>
        <dd>
          {PRECISION_LABEL[p.location.precision]}
          <span className="muted"> ({p.location.basis})</span>
        </dd>
      </dl>
      <div className="card-actions">
        <button type="button" className="primary" onClick={() => onZoom(p)}>
          Zoom to project
        </button>
        {p.url && (
          <a href={p.url} target="_blank" rel="noreferrer">
            View on {p.registry} registry
          </a>
        )}
      </div>
      <p className="card-source muted">
        Data: Berkeley Carbon Trading Project, Voluntary Registry Offsets Database (CC BY 4.0)
        {p.boundary ? "; boundary: Karnik et al. 2024 (CC BY 4.0)" : ""}.
      </p>
    </div>
  );
}
