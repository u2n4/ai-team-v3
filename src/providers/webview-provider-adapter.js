'use strict';

const { BaseProvider } = require('./base-provider');

const DEFAULT_PROVIDER_DEFINITIONS = Object.freeze({
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    allowedLiveTestStatus: 'READY_FOR_PROVIDER_DOCTOR',
    url: 'https://chat.qwen.ai/',
    partition: 'persist:ai-team-v3-qwen',
    inputSelectors: ['textarea.message-input-textarea', 'textarea[placeholder*="Message" i]', 'textarea[placeholder*="Ask" i]', 'textarea', '[contenteditable="true"]'],
    // Research-corrected (6+ live drivers): qwen DOES have a real send button at
    // div.chat-prompt-send-button button. It is a React controlled component — a
    // synthetic Enter leaves React's _valueTracker stale so the request body is empty
    // and the answer never streams. The native-value setter (in send-controller) repairs
    // the tracker, then CLICKING this button fires a trusted onClick with the real
    // payload. Click is required; Enter alone produces an empty answer.
    sendSelectors: ['div.chat-prompt-send-button button', '.chat-prompt-send-button button', 'button[aria-label*="Send message" i]'],
    enterSend: true,
    // Verified against the live qwen DOM: an assistant turn is
    // .response-message-content.phase-answer and its rendered text is in
    // .qwen-markdown / .custom-qwen-markdown. User turn = .response-message-content
    // WITHOUT phase-answer, so scope strictly to .phase-answer to avoid the echo.
    responseSelectors: ['.response-message-content.phase-answer .qwen-markdown', '.response-message-content.phase-answer .custom-qwen-markdown', '.response-message-content.phase-answer'],
    responseCountSelector: '.response-message-content.phase-answer',
    stabilityMs: 2200,
    maxPromptChars: 12000,
    thinkingSelectors: ['[class*="thinking" i]', '[class*="reasoning" i]'],
    stopSelectors: ['button[aria-label*="stop" i]', 'button:has-text("Stop")'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|quota|too many requests/i'],
    rateLimitSelectors: ['text=/rate limit|too many requests|usage limit|message limit|quota/i'],
    challengeSelectors: ['text=/captcha|cloudflare|verify you are human|checking your browser/i'],
    loginWallSelectors: ['text=/log in|sign in|continue with google|continue with apple/i'],
    paidWallSelectors: ['text=/upgrade|subscribe|payment required|paid plan/i'],
    cooldownPolicy: { consecutiveFailureLimit: 2, limitCooldownMs: 900000, failureCooldownMs: 120000 },
    redactionPolicy: { stripQuery: true, redactHeaders: true, redactBodyText: true, redactAccountData: true },
    safeFirstPrompt: 'AI Team V3 one-provider smoke test. Reply with exactly: AI_TEAM_V3_SMOKE_OK',
    selectorNotes: 'Qwen (chat.qwen.ai). Research-verified (6+ live drivers): composer textarea.message-input-textarea (React-controlled), REAL send button div.chat-prompt-send-button button (must click, not Enter), answer .response-message-content.phase-answer .qwen-markdown. Send works; capture may need a longer window.'
  },
  kimi: {
    id: 'kimi',
    name: 'Kimi',
    allowedLiveTestStatus: 'READY_FOR_PROVIDER_DOCTOR',
    url: 'https://www.kimi.com/',
    partition: 'persist:ai-team-v3-kimi',
    // kimi.com composer is a contenteditable .chat-input-editor (role=textbox), NOT a
    // textarea (verified live via Greasy Fork userscripts). Real send button is
    // .send-button inside .send-button-container (disabled while empty/streaming).
    inputSelectors: ['.chat-input-editor', '[class*="chat-input"] [contenteditable="true"]', '[contenteditable="true"]', '[role="textbox"]', 'textarea[placeholder*="Ask" i]', 'textarea'],
    sendSelectors: ['.send-button-container:not(.disabled) .send-button', 'button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button[type="submit"]'],
    enterSend: true,
    // Research-corrected: an assistant turn is a .segment-container that contains
    // .segment-assistant-actions-content; the reply body is .markdown. ([class*=assistant]
    // matched ZERO; .markdown-container does not exist in current kimi DOM.) Scope the
    // count to assistant action containers so the user echo isn't counted.
    responseSelectors: ['.segment-container:has(.segment-assistant-actions-content) .markdown', '.segment-container:has(.segment-assistant-actions-content)'],
    responseCountSelector: '.segment-assistant-actions-content',
    stabilityMs: 2400,
    maxPromptChars: 8000,
    thinkingSelectors: ['[class*="thinking" i]', '[class*="reasoning" i]', '[class*="think" i]'],
    stopSelectors: ['.send-button-container.is-stop .send-button', 'button[aria-label*="Stop" i]', 'button[aria-label*="停止"]', '[class*="stop" i]'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|quota|too many requests/i'],
    rateLimitSelectors: ['text=/rate limit|too many requests|usage limit|message limit|quota/i'],
    challengeSelectors: ['text=/captcha|cloudflare|verify you are human|checking your browser/i'],
    loginWallSelectors: ['text=/log in|sign in|continue with google|continue with apple/i'],
    paidWallSelectors: ['text=/upgrade|subscribe|payment required|paid plan/i'],
    cooldownPolicy: { consecutiveFailureLimit: 2, limitCooldownMs: 900000, failureCooldownMs: 120000 },
    redactionPolicy: { stripQuery: true, redactHeaders: true, redactBodyText: true, redactAccountData: true },
    safeFirstPrompt: 'AI Team V3 one-provider smoke test. Reply with exactly: AI_TEAM_V3_SMOKE_OK',
    selectorNotes: 'Kimi (kimi.com, intl). Research-verified (live userscripts): composer .chat-input-editor (contenteditable), send .send-button-container .send-button, assistant turn .segment-container:has(.segment-assistant-actions-content) body .markdown. Source: Greasy Fork Kimi scripts.'
  },
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    partition: 'persist:ai-team-v3-chatgpt',
    inputSelectors: ['#prompt-textarea', '[contenteditable="true"]', 'textarea'],
    sendSelectors: ['button[data-testid="send-button"]', 'button[aria-label*="Send" i]', 'button[type="submit"]'],
    responseSelectors: ['[data-message-author-role="assistant"]', '.markdown'],
    responseCountSelector: '[data-message-author-role="assistant"]',
    stabilityMs: 1600,
    thinkingSelectors: ['[data-testid*="reasoning" i]', '[class*="thinking" i]'],
    stopSelectors: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|too many requests|upgrade/i'],
    challengeSelectors: ['text=/captcha|cloudflare|verify you are human/i']
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    partition: 'persist:ai-team-v3-deepseek',
    allowedLiveTestStatus: 'READY_FOR_PROVIDER_DOCTOR',
    // Research-verified (7+ live drivers): deepseek composer is textarea#chat-input
    // (React-controlled). Send button is a div[role="button"], not a <button>; click it.
    // Enter inserts a newline — must click to send.
    inputSelectors: ['textarea#chat-input', 'textarea[placeholder*="DeepSeek" i]', 'textarea[placeholder*="Message" i]', 'form textarea', 'textarea'],
    // Send via ENTER (verified live): after trusted typing fills textarea#chat-input,
    // a trusted Enter submits and clears the composer. deepseek's send button is a div
    // with HASHED, build-changing classes (._52c986b.ds-icon-button) and there are
    // several ds-icon-button divs, so there's no stable button to click. The selectors
    // below intentionally do NOT match deepseek's real DOM (so findFirst returns null and
    // the controller falls through to a trusted Enter) while keeping the contract valid.
    sendSelectors: ['button[data-testid="send-button"]', 'button[aria-label="Send message"]'],
    enterSend: true,
    // deepseek shows an "Abnormal usage environment" modal + a chat-search popup that
    // COVER the composer (verified live). Their × is an svg .ds-modal-content__close —
    // no text, so dismiss it by exact selector before sending.
    // Two overlays cover deepseek's composer (verified via screenshot): the
    // "Abnormal usage environment" anti-bot modal AND a "Search chat content" popup.
    // Both close via an svg × — cover the modal close, the search popup close, and any
    // ds-icon-button sitting in a header/popup. NOTE: even when dismissed, the anti-bot
    // notice means deepseek may silently refuse to answer an automated message.
    dismissSelectors: ['.ds-modal-content__close', '.ds-modal-content__header-wrapper .ds-icon-button', '[class*="search" i] .ds-icon-button', '[class*="popup" i] .ds-icon-button', '[class*="search-popup" i] [class*="close" i]', '.ds-icon-button[class*="close" i]'],
    // Verified against the live deepseek DOM (probed 2026-05-30): the assistant answer
    // body is .ds-markdown.ds-assistant-message-main-content; the reasoning preface is
    // .ds-think-content. (.ds-markdown--block does NOT exist in the current DOM.) Scope
    // the count to the assistant main-content so the reasoning block / user echo aren't
    // counted.
    responseSelectors: ['.ds-markdown.ds-assistant-message-main-content', '.ds-assistant-message-main-content', '.ds-markdown'],
    responseCountSelector: '.ds-assistant-message-main-content',
    stabilityMs: 2200,
    maxPromptChars: 10000,
    thinkingSelectors: ['.ds-think-content', '.ds-markdown--think', '[class*="think" i]', '[class*="reasoning" i]'],
    stopSelectors: ['div[role="button"][aria-label*="stop" i]', 'button[aria-label*="stop" i]', '[class*="stop" i]'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|quota|too many requests/i'],
    rateLimitSelectors: ['text=/rate limit|too many requests|usage limit|message limit|quota/i'],
    challengeSelectors: ['text=/captcha|cloudflare|verify you are human|checking your browser/i'],
    loginWallSelectors: ['text=/log in|sign in|continue with google|continue with apple/i'],
    paidWallSelectors: ['text=/upgrade|subscribe|payment required|paid plan/i'],
    cooldownPolicy: { consecutiveFailureLimit: 2, limitCooldownMs: 900000, failureCooldownMs: 120000 },
    redactionPolicy: { stripQuery: true, redactHeaders: true, redactBodyText: true, redactAccountData: true },
    safeFirstPrompt: 'AI Team V3 one-provider smoke test. Reply with exactly: AI_TEAM_V3_SMOKE_OK',
    selectorNotes: 'DeepSeek (chat.deepseek.com). VERIFIED LIVE (PASS): composer textarea#chat-input (React-controlled); sends via TRUSTED ENTER (send button is a div with hashed build-changing classes, so sendSelectors intentionally do not match → controller falls through to Enter). Answer .ds-markdown.ds-assistant-message-main-content, reasoning .ds-think-content. Shows an "Abnormal usage environment" modal (.ds-modal-content__close) that dismissOverlays closes.'
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/app',
    partition: 'persist:ai-team-v3-gemini',
    inputSelectors: ['rich-textarea textarea', 'textarea', '[contenteditable="true"]'],
    sendSelectors: ['button[aria-label*="Send" i]', 'button[type="submit"]', '[data-test-id*="send" i]'],
    responseSelectors: ['message-content', '.markdown', '[class*="response" i]'],
    responseCountSelector: 'message-content, [class*="response" i]',
    stabilityMs: 1800,
    thinkingSelectors: ['[class*="thinking" i]', '[class*="thought" i]'],
    stopSelectors: ['button[aria-label*="Stop" i]', '[class*="stop" i]'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|quota|too many requests/i'],
    challengeSelectors: ['text=/captcha|verify you are human/i']
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    url: 'https://claude.ai/',
    partition: 'persist:ai-team-v3-claude',
    inputSelectors: ['div[contenteditable="true"]', 'textarea', '[aria-label*="prompt" i]'],
    sendSelectors: ['button[aria-label*="Send" i]', 'button[type="submit"]', '[data-testid*="send" i]'],
    responseSelectors: ['[data-testid*="message" i]', '.prose', '[class*="assistant" i]'],
    responseCountSelector: '[data-testid*="message" i], .prose',
    stabilityMs: 1800,
    thinkingSelectors: ['[class*="thinking" i]', '[class*="reasoning" i]'],
    stopSelectors: ['button[aria-label*="Stop" i]', '[data-testid*="stop" i]'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|usage|too many requests/i'],
    challengeSelectors: ['text=/captcha|cloudflare|verify you are human/i']
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    allowedLiveTestStatus: 'READY_FOR_PROVIDER_DOCTOR',
    url: 'https://www.perplexity.ai/',
    partition: 'persist:ai-team-v3-perplexity',
    inputSelectors: ['textarea[placeholder*="ask" i]', 'textarea', '[contenteditable="true"]', '[aria-label*="ask" i]'],
    sendSelectors: ['button[aria-label*="Submit" i]', 'button[aria-label*="Send" i]', 'button[type="submit"]'],
    enterSend: true,
    responseSelectors: ['[class*="answer" i]', '.prose', '[data-testid*="answer" i]'],
    responseCountSelector: '[class*="answer" i], .prose',
    stabilityMs: 2000,
    maxPromptChars: 8000,
    thinkingSelectors: ['[class*="thinking" i]', '[class*="sources" i]'],
    stopSelectors: ['button[aria-label*="Stop" i]', '[class*="stop" i]'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|usage|too many requests/i'],
    rateLimitSelectors: ['text=/rate limit|too many requests|usage limit|message limit|quota/i'],
    challengeSelectors: ['text=/captcha|cloudflare|verify you are human|checking your browser/i'],
    loginWallSelectors: ['text=/log in|sign in|continue with google|continue with apple/i'],
    paidWallSelectors: ['text=/upgrade|subscribe|payment required|paid plan/i'],
    cooldownPolicy: { consecutiveFailureLimit: 2, limitCooldownMs: 900000, failureCooldownMs: 120000 },
    redactionPolicy: { stripQuery: true, redactHeaders: true, redactBodyText: true, redactAccountData: true },
    safeFirstPrompt: 'AI Team V3 one-provider smoke test. Reply with exactly: AI_TEAM_V3_SMOKE_OK',
    selectorNotes: 'Perplexity (perplexity.ai). VERIFIED LIVE (PASS): Lexical composer, answer .prose.prose-invert / [data-testid=answer], sends via trusted Enter. Web-search phase precedes the answer so the stability window is wider.'
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    allowedLiveTestStatus: 'READY_FOR_PROVIDER_DOCTOR',
    url: 'https://grok.com/chat',
    partition: 'persist:ai-team-v3-grok',
    // Composer: grok renders a non-actionable <textarea> before the real
    // [contenteditable] editor, so list contenteditable first.
    inputSelectors: ['[contenteditable="true"]', 'textarea[placeholder*="Ask" i]', 'textarea[placeholder*="Message" i]', 'textarea', '[data-testid*="input" i]'],
    sendSelectors: ['button[aria-label*="Send" i]', 'button[type="submit"]', '[data-testid*="send" i]', '[class*="send" i]'],
    enterSend: true,
    // Verified against the live grok DOM. Scope STRICTLY to assistant containers:
    // generic .markdown / [class*=message-bubble] also match page chrome and suggested
    // prompts, and captureLatest picks the LAST non-empty match — which made capture
    // non-deterministic (one run clean, next run firewall-rejected). data-testid +
    // grok's own response-content-markdown are assistant-scoped and stable.
    responseSelectors: ['[data-testid="assistant-message"] .response-content-markdown', '[data-testid="assistant-message"]'],
    responseCountSelector: '[data-testid="assistant-message"]',
    stabilityMs: 2500,
    maxPromptChars: 10000,
    // grok prepends a "Thought for Ns / فكرت لمدة" reasoning preface; treat its
    // container as thinking so capture targets the final answer.
    thinkingSelectors: ['[class*="thinking" i]', '[class*="reasoning" i]', '[class*="thought" i]'],
    stopSelectors: ['button[aria-label*="Stop" i]', 'button[aria-label*="إيقاف" i]', '[class*="stop" i]'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|quota|too many requests|upgrade/i'],
    rateLimitSelectors: ['text=/rate limit|too many requests|usage limit|message limit|quota/i'],
    challengeSelectors: ['text=/captcha|cloudflare|verify you are human|checking your browser/i'],
    loginWallSelectors: ['text=/log in|sign in|continue with x|continue with google|continue with apple/i'],
    paidWallSelectors: ['text=/upgrade|subscribe|premium|payment required/i'],
    cooldownPolicy: { consecutiveFailureLimit: 2, limitCooldownMs: 900000, failureCooldownMs: 120000 },
    redactionPolicy: { stripQuery: true, redactHeaders: true, redactBodyText: true, redactAccountData: true },
    safeFirstPrompt: 'AI Team V3 one-provider smoke test. Reply with exactly: AI_TEAM_V3_SMOKE_OK',
    selectorNotes: 'Grok (grok.com/chat). VERIFIED LIVE (PASS x5): assistant anchor [data-testid="assistant-message"], composer [contenteditable], sends via trusted Enter (no send button). Real DOM probed 2026-05-30.'
  },
  zai: {
    id: 'zai',
    name: 'Z.AI',
    allowedLiveTestStatus: 'READY_FOR_PROVIDER_DOCTOR',
    url: 'https://chat.z.ai/',
    partition: 'persist:ai-team-v3-zai',
    // Verified against live z.ai (Open WebUI) DOM (probed 2026-05-30): the composer is a
    // plain textarea#chat-input (NOT ProseMirror), and the send button is the <button>
    // #send-message-button. Trusted typing fills the textarea; click the button to send.
    inputSelectors: ['textarea#chat-input', '#chat-input', 'textarea'],
    sendSelectors: ['#send-message-button', 'button#send-message-button', 'button[aria-label*="Send" i]'],
    enterSend: true,
    // Verified against the live z.ai (Open WebUI) DOM (probed 2026-05-30): user turn is
    // .chat-user.markdown-prose, assistant turn is .chat-assistant.markdown-prose. Scope
    // STRICTLY to .chat-assistant so the user's echoed prompt isn't captured (that echo
    // was tripping the response firewall).
    responseSelectors: ['.chat-assistant .markdown-prose', '.chat-assistant'],
    responseCountSelector: '.chat-assistant',
    stabilityMs: 2400,
    maxPromptChars: 10000,
    thinkingSelectors: ['[class*="thinking" i]', '[class*="reasoning" i]', '[class*="thought" i]'],
    stopSelectors: ['button[aria-label*="Stop" i]', '[class*="stop" i]'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|quota|too many requests/i'],
    rateLimitSelectors: ['text=/rate limit|too many requests|usage limit|message limit|quota/i'],
    challengeSelectors: ['text=/captcha|cloudflare|verify you are human|checking your browser/i'],
    loginWallSelectors: ['text=/log in|sign in|continue with google/i'],
    paidWallSelectors: ['text=/upgrade|subscribe|payment required|paid plan/i'],
    cooldownPolicy: { consecutiveFailureLimit: 2, limitCooldownMs: 900000, failureCooldownMs: 120000 },
    redactionPolicy: { stripQuery: true, redactHeaders: true, redactBodyText: true, redactAccountData: true },
    safeFirstPrompt: 'AI Team V3 one-provider smoke test. Reply with exactly: AI_TEAM_V3_SMOKE_OK',
    selectorNotes: 'Z.AI (chat.z.ai, GLM). Research-verified: Open WebUI/TipTap; composer #chat-input .ProseMirror, send #send-message-button, contenteditable needs execCommand insertText. Assistant anchor unverified live (needs logged-in session). Source: MCP-SuperAssistant z.adapter.'
  },
  meta: {
    id: 'meta',
    name: 'Meta AI',
    allowedLiveTestStatus: 'READY_FOR_PROVIDER_DOCTOR',
    url: 'https://www.meta.ai/',
    partition: 'persist:ai-team-v3-meta',
    // meta.ai composer is Meta's Lexical editor: a contenteditable <div data-lexical-editor>
    // with role=textbox — NOT a <textarea>. isContentEditable is false until Lexical
    // hydrates, so lead with the Lexical/contenteditable signature (grok lesson) — this
    // is what resolves the doctor's COMPOSER_NOT_ACTIONABLE verdict. The "Ask Meta AI"
    // placeholder is a sibling overlay div, so a placeholder textarea selector never matches.
    inputSelectors: ['[data-lexical-editor="true"]', 'div[contenteditable="true"][role="textbox"]', '[contenteditable="true"]', '[role="textbox"]', 'textarea'],
    sendSelectors: ['button[aria-label*="Send" i]', 'div[role="button"][aria-label*="Send" i]', 'button[type="submit"]'],
    enterSend: true,
    // Dropped the generic [dir="auto"] selector (matched chrome). Response anchor is
    // still UNVERIFIED against the live meta DOM — confirm via probe before trusting.
    responseSelectors: ['[data-testid*="assistant" i]', '[role="article"]'],
    responseCountSelector: '[data-testid*="assistant" i]',
    stabilityMs: 2200,
    maxPromptChars: 8000,
    thinkingSelectors: ['[class*="thinking" i]', '[class*="reasoning" i]'],
    stopSelectors: ['button[aria-label*="Stop" i]', '[class*="stop" i]'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|quota|too many requests/i'],
    rateLimitSelectors: ['text=/rate limit|too many requests|usage limit|message limit|quota/i'],
    challengeSelectors: ['text=/captcha|verify you are human|checking your browser/i'],
    loginWallSelectors: ['text=/log in|sign in|continue with facebook|continue with google/i'],
    paidWallSelectors: ['text=/upgrade|subscribe|payment required/i'],
    cooldownPolicy: { consecutiveFailureLimit: 2, limitCooldownMs: 900000, failureCooldownMs: 120000 },
    redactionPolicy: { stripQuery: true, redactHeaders: true, redactBodyText: true, redactAccountData: true },
    safeFirstPrompt: 'AI Team V3 one-provider smoke test. Reply with exactly: AI_TEAM_V3_SMOKE_OK',
    selectorNotes: 'Meta AI (meta.ai). Research-verified: Lexical composer [data-lexical-editor], needs synthetic beforeinput insertText. COMPOSER_NOT_ACTIONABLE is caused by a cookie-consent/login [role=dialog] overlay covering the composer — must dismiss the dialog first, not a selector problem.'
  },
  manus: {
    id: 'manus',
    name: 'Manus',
    allowedLiveTestStatus: 'READY_FOR_PROVIDER_DOCTOR',
    url: 'https://manus.im/app',
    partition: 'persist:ai-team-v3-manus',
    inputSelectors: ['textarea[placeholder*="Message" i]', 'textarea[placeholder*="Ask" i]', 'textarea', '[contenteditable="true"]', '[class*="input" i]'],
    sendSelectors: ['button[aria-label*="Send" i]', 'button[type="submit"]', '[class*="send" i]', '[data-testid*="send" i]'],
    enterSend: true,
    responseSelectors: ['[class*="assistant" i]', '.markdown', '[class*="message" i]', '[class*="content" i]'],
    responseCountSelector: '[class*="assistant" i], .markdown',
    stabilityMs: 2600,
    maxPromptChars: 8000,
    thinkingSelectors: ['[class*="thinking" i]', '[class*="reasoning" i]', '[class*="step" i]'],
    stopSelectors: ['button[aria-label*="Stop" i]', '[class*="stop" i]'],
    errorSelectors: ['[role="alert"]', '[class*="error" i]'],
    limitSelectors: ['text=/limit|quota|too many requests|credits/i'],
    rateLimitSelectors: ['text=/rate limit|too many requests|usage limit|message limit|quota|out of credits/i'],
    challengeSelectors: ['text=/captcha|cloudflare|verify you are human|checking your browser/i'],
    loginWallSelectors: ['text=/log in|sign in|continue with google|continue with apple/i'],
    paidWallSelectors: ['text=/upgrade|subscribe|payment required|paid plan|out of credits/i'],
    cooldownPolicy: { consecutiveFailureLimit: 2, limitCooldownMs: 900000, failureCooldownMs: 120000 },
    redactionPolicy: { stripQuery: true, redactHeaders: true, redactBodyText: true, redactAccountData: true },
    safeFirstPrompt: 'AI Team V3 one-provider smoke test. Reply with exactly: AI_TEAM_V3_SMOKE_OK',
    selectorNotes: 'Manus (manus.im/app). Research-verified: TipTap/ProseMirror composer div.tiptap.ProseMirror, send button[type=submit], needs innerHTML <p> wrap + event burst. NOTE: Manus is AGENTIC — the reply is a task/step STREAM, not one bubble; consider the task.detail API for capture.'
  }
});

class WebviewProviderAdapter extends BaseProvider {
  constructor({ definition, sendController, lifecycleMonitor, domCapture }) {
    super({ id: definition.id, name: definition.name, timeoutMs: definition.timeoutMs || 60000 });
    this.definition = definition;
    this.sendController = sendController;
    this.lifecycleMonitor = lifecycleMonitor;
    this.domCapture = domCapture;
    this.sendTimeoutMs = definition.sendTimeoutMs || 90000;
  }

  cancelPending() {
    const wc = this.sendController && this.sendController.webContents;
    if (wc && !wc.isDestroyed()) wc.close();
  }

  async send(promptText, context) {
    // Snapshot the response area BEFORE sending so waitForResponse can't mistake the
    // previous turn's answer for this turn's reply (the lifecycle monitor treats any
    // captured text as "new" when no baseline is supplied).
    this._baselineCount = null;
    this._baselineText = '';
    if (this.domCapture && typeof this.domCapture.count === 'function') {
      this._baselineCount = await this.domCapture.count(this.definition.responseCountSelector);
    }
    if (this.domCapture && typeof this.domCapture.captureLatest === 'function') {
      const baseline = await this.domCapture.captureLatest(this.definition);
      this._baselineText = String((baseline && baseline.text) || '');
    }
    return this.sendController.sendPrompt({
      provider: this.definition,
      promptText,
      context
    });
  }

  async waitForResponse(context = {}) {
    // Honor the caller's per-turn timeout (or the provider's own) so one slow/silent
    // provider can't stall the serial discussion ring on the 60s lifecycle default.
    const timeoutMs = (context && context.timeoutMs) || this.definition.timeoutMs;
    return this.lifecycleMonitor.waitForStableResponse({
      provider: this.definition,
      context,
      domCapture: this.domCapture,
      baselineCount: this._baselineCount,
      baselineText: this._baselineText,
      ...(timeoutMs ? { timeoutMs } : {})
    });
  }
}

module.exports = {
  WebviewProviderAdapter,
  DEFAULT_PROVIDER_DEFINITIONS
};
