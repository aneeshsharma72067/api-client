# API Client

A lightweight API client and request workspace built with React, TypeScript, Vite, Tailwind CSS and shadcn-ui. Use it to build, send, and compare HTTP requests locally, import collections (cURL/OpenAPI/Postman), and manage multiple request workspaces.

## Features

- Build HTTP requests with URL, method, headers, query params and body
- Import requests from cURL, OpenAPI, Postman, and HAR
- View and compare responses with a built-in response viewer
- Workspace support for organizing collections and environments
- Small, fast dev environment powered by Vite

## Tech stack

- Vite
- React + TypeScript
- Tailwind CSS
- shadcn-ui (Radix + Tailwind components)

## Requirements

- Node.js 18+ (or the version compatible with the project's devDependencies)
- npm (or any Node package manager)

## Quick start

```bash
# Clone the repository
git clone <YOUR_GIT_URL>
cd api-client

# Install dependencies
npm install

# Start dev server
npm run dev
```

Available npm scripts (from package.json):

- `dev` — start the Vite dev server
- `build` — build production assets
- `build:dev` — build in development mode
- `preview` — preview the production build locally
- `lint` — run ESLint

## Development notes

- The UI components live under `src/components`.
- Importers for cURL/OpenAPI/Postman/HAR are in `src/lib/imports`.
- HTTP runtime and client helpers are in `src/lib/http`.
- Pages are in `src/pages` and the main app entry is `src/main.tsx`.

If you add environment-specific configuration, document it here and create an `.env.example` with the required variables.

## Contributing

Contributions are welcome. Please open issues for bugs or feature requests and submit pull requests with a clear description of changes.

Suggested workflow:

```bash
git checkout -b feat/your-feature
# implement
git commit -m "feat: describe"
git push origin feat/your-feature
```

## License

This repository does not include a license file. Add one if you intend to make the project public. Common choices: MIT, Apache-2.0.

---

If you'd like, I can also:

- add an `.env.example` if the app needs config
- create a CONTRIBUTING.md template
- run the dev server to verify everything starts up
