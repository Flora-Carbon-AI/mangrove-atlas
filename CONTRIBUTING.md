# Contributing to Mangrove Atlas

Thanks for helping map the world's mangroves. This guide covers how to propose changes, how we review them, and what we expect in a pull request.

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug.** Open an issue with the bug template. Include the dataset, year, place and browser.
- **Suggest a dataset.** Open an issue with the dataset template. Link the source, licence and citation.
- **Improve the map or docs.** Small fixes are welcome without an issue. For anything bigger, open an issue first so we can agree on the approach before you write code.
- **Check the data.** If a layer looks wrong somewhere you know well, tell us where and why. Local knowledge is valuable.

## How changes reach `main`

`main` is protected. Nobody pushes to it directly, maintainers included.

1. Fork the repository, or create a branch if you have write access. Name branches by intent, such as `fix/timeline-keyboard` or `feat/gmw-v4`.
2. Make your change in small, focused commits.
3. Open a pull request against `main` and fill in the template.
4. **CI must pass.** It runs lint, typecheck and a production build.
5. **Netlify builds a deploy preview** and links it on the PR. For PRs from forks, a maintainer approves that build first, because preview builds can reach the site's settings.
6. A maintainer reviews and squash-merges the PR. Merging to `main` deploys to https://mangrove-atlas-floracarbon.netlify.app automatically.

## Local setup

Requires Node.js 20 or newer (CI uses 22).

```bash
npm install
npm run dev
```

The Planetary Computer datasets work with no credentials. To work on the Earth Engine datasets, follow "Turning on Earth Engine" in the [README](README.md). Use your own service account, and never commit keys: `.env*` files and `*-key.json` files are git-ignored.

Before you open a PR:

```bash
npm run lint
npm run typecheck
npm run build
```

## Pull request checklist

- [ ] The PR does one thing and explains why.
- [ ] Lint, typecheck and build pass locally.
- [ ] UI changes include a before/after screenshot, and you have checked a phone-width view.
- [ ] Interactive controls work with the keyboard and have accessible names.
- [ ] New datasets have a citation, licence and source link in `src/lib/datasets.ts` and the README data table.
- [ ] Nothing secret is committed: no keys, tokens or `.env` files.

## Adding a dataset

1. Add an entry to `DATASETS` in `src/lib/datasets.ts`. Include years, resolution, citation, licence, source URL and `supportsChange`.
2. Implement it in the provider module:
   - `src/lib/server/ee.ts` for Google Earth Engine. Add a mask function that returns 1 = mangrove, 0 = not.
   - `src/lib/server/mpc.ts` for Microsoft Planetary Computer. Add an expression such as `map==95`.
3. Describe what "mangrove" means in that dataset in the README data table: the class, the threshold and any caveats.
4. Only use data whose licence allows public display. Say so in the PR.

## Code style

- TypeScript throughout, with no `any` in new code.
- Code that touches credentials stays in `src/lib/server/` and imports `server-only`.
- Do not send provider error messages to the browser. Log them on the server and return a short, plain message.
- Comments explain *why*, not *what*.
- User-facing text is plain and specific. Buttons say what they do ("Measure mangroves in view", not "Submit").

## Commit messages

Use the imperative mood ("Add dark basemap", not "Added dark basemap"). Keep the first line under about 72 characters, and use the body for the why.

## Reporting security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).

## Licence

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE). Map data keeps its own licences; see the README.
