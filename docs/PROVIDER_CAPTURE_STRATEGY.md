# Provider Capture Strategy

Current policy: ChatGPT, Claude and Gemini are forbidden live. Any provider catalog below includes offline/fake metadata only; it does not authorize opening those providers.

## Capture Order

1. DOM response selectors.
2. Response count baseline and guard.
3. Stability guard.
4. Role/user-bubble rejection.
5. Prompt echo and briefing echo rejection.
6. Thinking/UI cleanup.
7. CDP/network diagnostic fallback only when DOM fails.
8. Screenshot/text xray for debugging.

## Initial Providers

Provider configs live in `src/providers/webview-provider-adapter.js`.

- qwen: `https://chat.qwen.ai/`, partition `persist:ai-team-v3-qwen`.
- kimi: `https://www.kimi.com/`, partition `persist:ai-team-v3-kimi`.
- chatgpt: `https://chatgpt.com/`, partition `persist:ai-team-v3-chatgpt`.
- deepseek: `https://chat.deepseek.com/`, partition `persist:ai-team-v3-deepseek`.
- gemini: `https://gemini.google.com/app`, partition `persist:ai-team-v3-gemini`.
- claude: `https://claude.ai/`, partition `persist:ai-team-v3-claude`.
- perplexity: `https://www.perplexity.ai/`, partition `persist:ai-team-v3-perplexity`.

## Diagnostic Xray

`DomCapture.xray(provider)` returns:

- current URL,
- document title,
- body text preview,
- per-selector counts.

The xray output is debugging evidence only. It must never enter the transcript.

## Live Testing Gate

First live provider must be Qwen or Kimi. ChatGPT, Claude and Gemini are forbidden live. Perplexity and other room candidates remain human-gated and are outside the first qwen/kimi smoke step. Stop provider safely on challenge, limit, paid access, blocked composer, or unstable capture.
