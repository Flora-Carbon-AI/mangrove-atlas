# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub. Don't open a public issue.

Go to **Security → Report a vulnerability** on [the repository](https://github.com/Flora-Carbon-AI/mangrove-atlas/security/advisories/new).

Include what you found, how to reproduce it, and the impact you expect. We aim to acknowledge reports within 5 working days.

## Scope

In scope:

- The application code in this repository: the Next.js app and API routes under `src/app/api`.
- How the app handles Earth Engine credentials, and the server-side requests it makes.
- The live deployment at https://mangrove-atlas-floracarbon.netlify.app.

Out of scope:

- Vulnerabilities in Google Earth Engine, Microsoft Planetary Computer, OpenFreeMap or Esri services. Report those to the providers.
- Denial of service by sending large numbers of requests.

## How credentials are handled

- Earth Engine credentials live only in server environment variables, which are read in `src/lib/server/ee.ts`.
- They are never sent to the browser or committed to the repository.
- Pull requests from forks don't get a deploy preview with these settings until a maintainer approves the build.
