# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub. Don't open a public issue.

Go to **Security → Report a vulnerability** on [the repository](https://github.com/Flora-Carbon-AI/mangrove-atlas/security/advisories/new).

Include what you found, how to reproduce it, and the impact you expect. We aim to acknowledge reports within 5 working days.

## Scope

In scope:

- The application code in this repository: the Next.js app, the API routes under `src/app/api` and the data pipeline under `pipeline/`.
- The GitHub Actions workflows, including the one that publishes the data to GitHub Pages.
- The live deployment at https://mangrove-atlas-floracarbon.netlify.app.

Out of scope:

- Vulnerabilities in Microsoft Planetary Computer, GitHub Pages, OpenFreeMap, Esri or Zenodo. Report those to the providers.
- Denial of service by sending large numbers of requests.

## Credentials

- The app itself uses no API keys or secrets. The map data is a public static file, and the Planetary Computer APIs are public.
- There are no secrets. The data is published to GitHub Pages by the "Build mangrove tiles" workflow, using GitHub's built-in deployment token, and only from `main`.
