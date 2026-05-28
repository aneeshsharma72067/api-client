# API Client — Core Feature Spec (Brief)

## Product Positioning

A fast, local-first, Git-native API client focused on:

* developer productivity
* debugging visibility
* filesystem portability
* zero cloud dependency

Core differentiators:

1. Git-native collections
2. AI-assisted request generation
3. Advanced observability/debugging

---

# 1. Git-Native Collections

## Goal

Store API requests as readable filesystem files instead of proprietary databases.

## Features

* Workspace = folder on disk
* YAML-based request files
* Git-friendly structure
* Environment variable support
* Live filesystem sync
* Auto reload on file changes
* Import/export support

## Example Structure

```txt id="afqjrm"
workspace/
├── auth/
│   └── login.yaml
├── users/
│   └── get-users.yaml
└── environments/
    └── dev.env
```

## Example Request

```yaml id="s5yd9r"
name: Get Users
method: GET
url: "{{BASE_URL}}/users"

headers:
  Authorization: "Bearer {{TOKEN}}"
```

## Key Requirements

* Git diff friendly
* Human editable
* Fast loading
* File watcher support
* Postman/OpenAPI import

## Tech Notes

* Tauri + Rust preferred
* YAML parser
* Filesystem as source of truth

---

# 2. AI-Assisted Request Generation

## Goal

Convert API docs or curl commands into usable collections automatically.

## Supported Inputs

* curl
* OpenAPI
* Swagger
* Markdown docs
* HAR files

## Features

* Auto request generation
* Auth detection
* Environment extraction
* Endpoint grouping
* Collection auto-organization

## Example

Input:

```bash id="flul3w"
curl -X GET https://api.test.com/users
```

Output:

* generated request
* headers extracted
* grouped into collection

## AI Workflow

1. Parse input
2. Detect endpoints
3. Extract auth
4. Generate requests
5. Save into workspace

## Requirements

* Preview before import
* Deterministic outputs
* Never auto-run destructive requests

## Architecture

```ts id="clmbri"
interface AIProvider {
  generateCollection(input: string): Promise<Collection>
}
```

---

# 3. Observability & Debugging

## Goal

Turn the client into an API debugging workstation.

## Features

* DNS timing
* TLS handshake timing
* Request lifecycle waterfall
* Redirect tracking
* Raw request inspection
* TLS certificate info
* Retry visualization
* JSON diffing
* WebSocket/SSE debugging

## Example Timing

```txt id="a7o8dh"
DNS Lookup        12ms
TCP Connect       24ms
TLS Handshake     40ms
Server Processing 180ms
```

## Requirements

* Visual timeline UI
* Stream large responses
* Handle 50MB+ payloads
* Raw HTTP inspection

## Advanced Features

* Error intelligence
* Security header analysis
* Response comparison
* Replay debugging

## Tech Notes

* Native Rust networking preferred
* Virtualized JSON rendering
* Streaming response parser

