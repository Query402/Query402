# Contributing to Query402

Thanks for contributing to Query402. This guide covers the shortest path from a
clean checkout to a local API and web dashboard, plus the checks expected before
opening a pull request.

## Prerequisites

- Node.js `24.14.1`, matching [`.nvmrc`](./.nvmrc)
- npm (the version bundled with Node.js)

With `nvm`, select the repository's Node version before installing dependencies:

```bash
nvm install
nvm use
node --version
```

The last command should report `v24.14.1`.

## First-time setup

From the repository root, install the locked dependency versions:

```bash
npm ci
```

The API reads local configuration from `.env`. The checked-in
`.env.example` contains placeholders and enables deterministic `DEMO_MODE`; it
does not contain real credentials. Copy it for local development:

```bash
cp .env.example .env
```

Do not commit `.env`, replace placeholders with production secrets, or enable
real-payment validation for routine development. Provider API keys are
optional; demo mode uses deterministic local responses when they are absent.
The quickstart does not require wallet, payment, or provider credentials.

## Workspace layout

Query402 is an npm-workspaces monorepo:

```text
apps/api/          Express API, providers, x402 routes, and analytics
apps/web/          React + Vite dashboard
apps/agent-client/ CLI for search, news, and scrape requests
packages/shared/   Shared TypeScript types and Zod schemas
```

Root scripts coordinate the workspaces. A workspace-specific script can also
be run with npm's `--workspace` option, for example:

```bash
npm run typecheck --workspace @query402/api
```

## Run locally

Start the API in one terminal:

```bash
npm run dev:api
```

It listens on `http://localhost:3001` by default.

Start the web dashboard in a second terminal:

```bash
npm run dev:web
```

Open `http://localhost:5173`. The web app uses the API URL from
`VITE_API_BASE_URL` (the example configuration points to the default API
port). Keep both development processes running while using the dashboard.

## Quality checks

Run these commands from the repository root before submitting a change:

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
```

These scripts check every workspace using the versions pinned in
`package-lock.json`. The test suite is deterministic and does not require
wallets, live payments, or provider credentials.

## Pull request checklist

- [ ] The change is focused and includes relevant documentation or tests.
- [ ] `npm run typecheck`, `npm test`, and `npm run lint` pass.
- [ ] `npm run format:check` passes (or formatting was applied with `npm run format`).
- [ ] No `.env` files, credentials, private keys, or generated build output are committed.
- [ ] The pull request description explains the change and links the related issue.

...
