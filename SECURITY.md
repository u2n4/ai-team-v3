# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Architecture

AI Team V3 drives external AI web UIs inside isolated Electron views and stores local session state on the user's machine. Security of cookies, tokens, the local vault, and IPC boundaries is the primary invariant.

### 1. Electron Process & View Isolation

- **Host Window (`src/electron/main.js`):** Runs with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, `webviewTag: false`, and a strict Content Security Policy (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`).
- **Preload Bridge (`src/electron/preload.js`):** Exposes a minimal whitelisted surface (`window.aiTeamV3`) via `contextBridge.exposeInMainWorld`. Raw `ipcRenderer` and `IpcRendererEvent` objects are never exposed to the renderer.
- **Provider Views (`src/electron/provider-window-manager.js`):** Each provider runs in a dedicated `WebContentsView` with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, no preload script (`preload: undefined`), and an isolated `persist:` partition.

### 2. Two-Signal Live Session & Forbidden Provider Gates

- **No Startup Network Contact:** Launching the app (`npm run app`) or running tests (`npm test`) never contacts live provider domains.
- **Two-Signal Open Gate:** `evaluateProviderOpen` requires both explicit UI confirmation (`approval.confirmed === true`) and the process environment gate (`AI_TEAM_V3_CONFIRM_SAFE_SESSION=1`) before any live provider window can open.
- **Forbidden Providers:** `chatgpt` and `claude` are rejected at the policy and IPC boundary (`BLOCKED_PROVIDER_FORBIDDEN`) before any window or session can be created.

### 3. Cookie Importer & Local Session Vault

- **Encrypted Vault (`src/electron/localstorage-vault.js`):** LocalStorage session tokens under `.tmp/ls-vault/` (gitignored) are encrypted using Electron `safeStorage` (`version: 2`, `electron-safe-storage-base64`) and restricted to the current OS user (`0600` mode plus `icacls` inheritance removal on Windows). Saving new vaults fails closed (`returns 0`) if `safeStorage` encryption is unavailable.
- **Cookie Importer Blocklist (`src/electron/edge-cookie-importer.js`):** Only allowlisted providers (`qwen`, `kimi`) can be imported, and a hard blocklist prevents importing cookies from `chatgpt.com`, `openai.com`, `claude.ai`, `anthropic.com`, `gemini.google.com`, `google.com`, `accounts.google.com`, `microsoft.com`, `live.com`, `microsoftonline.com`, and `office.com`.

### 4. Redaction & Transcript Firewall

- **Metadata-Only Diagnostics & Traces (`src/core/redact.js`, `src/electron/cdp-monitor.js`):** Cookies, tokens, `Authorization` headers, query parameters, email addresses, local filesystem paths, and CDP network bodies (`data`, `payloadData`, `postData`, `body`) are redacted before storage.
- **Transcript Firewall (`src/core/response-normalizer.js`):** Diagnostics, challenge pages, rate-limit notices, and prompt echoes are routed exclusively to `DiagnosticsStore` and never enter `TranscriptStore` or subsequent provider prompts.

### 5. Repository Hygiene

Never commit:
- `.env` or `.env.*` files
- Private keys (`*.pem`), `*cookies*.json`, or `*credentials*.json`
- `.tmp/` (including `.tmp/ls-vault/`)
- `traces/` or `release/`
- Generated `docs/*REPORT*` or `docs/V3_TRACE_REPORT_VIEWER.html`
- Personal data (real names, emails, home directory paths, or private IP addresses)

## Reporting a Vulnerability

Please report security vulnerabilities privately through GitHub Security Advisories on this repository rather than opening a public issue with exploit details. Include:

1. Affected component (`src/electron/`, `src/core/`, `src/providers/`, or scripts).
2. Steps to reproduce offline (without live credentials or session tokens).
3. Impact assessment (IPC boundary, vault confidentiality, redaction, or partition isolation).
