# Research

Date: 2026-05-16

Context7 was requested in the project rules, but no Context7 MCP tool was exposed in this Codex session. I used current official docs directly.

## Sources Consulted

- Electron `<webview>` tag: https://www.electronjs.org/docs/latest/api/webview-tag
- Electron `BrowserView`: https://www.electronjs.org/docs/latest/api/browser-view
- Electron `WebContentsView`: https://www.electronjs.org/docs/latest/api/web-contents-view
- Electron `webContents.executeJavaScript`: https://www.electronjs.org/docs/latest/api/web-contents
- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron context isolation: https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Chrome DevTools Protocol Network domain: https://chromedevtools.github.io/devtools-protocol/tot/Network/
- MDN `MutationObserver`: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver

## Electron Container Decision

Electron currently warns that `<webview>` stability is affected by Chromium architectural changes and recommends alternatives such as `WebContentsView`. `BrowserView` is deprecated in Electron >=29 and replaced by `WebContentsView`.

V3 therefore scaffolds `WebContentsView` first and keeps `BrowserView` only as a runtime fallback. The main app disables `webviewTag`.

## Async Lifecycle

Embedded content runs out-of-process, and interactions with embedded content are asynchronous. V3 avoids fixed sleeps as the primary signal. The lifecycle plan is:

1. Open a stable persistent partition per provider.
2. Wait for DOM selectors and response count baseline.
3. Install a `MutationObserver`.
4. Capture only after response count and text stability guards pass.
5. Reject partial tails in `ResponseNormalizer`.

## `executeJavaScript`

Electron `webContents.executeJavaScript` returns a promise and code execution is suspended until page loading stops. V3 wraps every DOM operation in explicit success/failure objects and does not treat injection as send success until the send controller verifies a click or Enter fallback path.

## MutationObserver

MDN defines `MutationObserver` as the browser API for watching DOM tree changes. V3 uses it as a signal that streamed content is still changing, not as the final answer source by itself.

## CDP Network Domain

The Chrome DevTools Protocol Network domain exposes request/response and streaming-adjacent events:

- `Network.requestWillBeSent`
- `Network.responseReceived`
- `Network.loadingFinished`
- `Network.eventSourceMessageReceived`
- `Network.webSocketFrameReceived`

V3 treats CDP as diagnostics/fallback only. It redacts URLs, headers, cookies, authorization values, tokens, secrets, and API keys before trace storage.

## Modern AI Site Streaming

Modern AI sites usually render answer text incrementally into the DOM while also using fetch, EventSource, or WebSocket streams. The safe V3 path is DOM-first:

1. Capture assistant response nodes, never the whole body.
2. Compare response count against a baseline.
3. Wait for text stability.
4. Reject user bubbles, prompt echo, briefing echo, UI chrome, and thinking blocks.
5. Use CDP only to diagnose why DOM capture failed.

## Anti-Abuse Boundary

V3 only automates legitimate user sessions. It must stop safely on CAPTCHA, Cloudflare, account limits, rate limits, paid access walls, or unavailable provider state. It must not bypass challenges, rotate identities, spoof account limits, or retry aggressively.

## Provider Challenge Landscape

These are stop conditions, not bypass targets:

- Qwen: login/session expiry, CAPTCHA, rate/usage limit, composer disabled while files upload.
- Kimi: login/session expiry, CAPTCHA, slow streaming instability, usage limit.
- ChatGPT: Cloudflare or human verification, message cap, login wall, disabled composer, plan/upgrade wall.
- DeepSeek: server busy page, login expiry, rate limit, generated-answer still streaming.
- Gemini: Google account re-login, safety/interruption card, disabled send button, usage/service limit.
- Claude: Cloudflare or human verification, usage limit, paid-access wall. Live testing is explicitly disallowed for the first gate.
- Perplexity: Cloudflare or human verification, usage limit, login/subscription wall. Live testing is explicitly disallowed for the first gate.
