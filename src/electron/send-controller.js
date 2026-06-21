'use strict';

function verifySendObservation(observation) {
  const result = {
    ...observation,
    verified: false,
    verifyReason: 'not_verified'
  };
  if (!observation || observation.ok !== true) {
    return {
      ...(observation || {}),
      verified: false,
      verifyReason: observation && observation.code ? observation.code : 'action_failed'
    };
  }

  const baseline = Number(observation.baselineResponseCount || 0);
  const finalCount = Number(observation.finalResponseCount || 0);
  if (observation.responseCountSelector && finalCount > baseline) {
    result.verified = true;
    result.verifyReason = 'response_count_increment';
    return result;
  }

  if (String(observation.composerTextAfterSend || '').trim() === '') {
    result.verified = true;
    result.verifyReason = 'composer_clear';
    return result;
  }

  result.code = 'SEND_NOT_VERIFIED';
  return result;
}

class SendController {
  constructor({ webContents, diagnosticsStore, hostWindow = null, verificationTimeoutMs = 6000, verificationPollMs = 100 }) {
    this.webContents = webContents;
    this.diagnosticsStore = diagnosticsStore;
    // The host BrowserWindow (if provided) is raised+focused right before a trusted
    // Enter — sendInputEvent only lands when the WINDOW holds OS focus, not just the
    // child WebContentsView (electron#8273). This is what made qwen submit in the
    // isolated probe but not under the smoke driver.
    this.hostWindow = hostWindow;
    this.verificationTimeoutMs = verificationTimeoutMs;
    this.verificationPollMs = verificationPollMs;
  }

  // Type the prompt with TRUSTED input: focus the composer with a real mouse click
  // (sendInputEvent), then send char events. Controlled SPA inputs (qwen/deepseek/zai —
  // React/Svelte) ignore a programmatic node.value/textContent assignment, so the message
  // reaches the backend EMPTY even though the composer "looks" filled. Trusted events are
  // indistinguishable from human typing, so the framework registers the value correctly.
  // Returns true if the composer actually holds the text afterward.
  async trustedTypeIntoComposer(provider, promptText) {
    if (typeof this.webContents.sendInputEvent !== 'function') return false;
    try {
      if (this.hostWindow) { try { this.hostWindow.show(); this.hostWindow.focus(); this.hostWindow.moveTop(); } catch (_e) {} }
      if (typeof this.webContents.focus === 'function') this.webContents.focus();
      // Find the actionable composer's center + clear it, in-page.
      const box = await this.webContents.executeJavaScript(`
        (() => {
          const sels = ${JSON.stringify(provider.inputSelectors || [])};
          const isAct = (el) => { try { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null && !el.disabled && !el.readOnly; } catch (_e) { return false; } };
          let node = null;
          for (const sel of sels) { for (const el of document.querySelectorAll(sel)) { if (isAct(el)) { node = el; break; } } if (node) break; }
          if (!node) return null;
          node.focus();
          try { if ('value' in node) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value'); if (d && d.set) d.set.call(node, ''); node.dispatchEvent(new Event('input', { bubbles: true })); } else { node.textContent = ''; } } catch (_e) {}
          const r = node.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        })();
      `);
      if (!box) return false;
      this.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      this.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await new Promise((r) => setTimeout(r, 250));
      // Emit one TRUSTED char event per character (unchanged semantics: every
      // keystroke still reaches the SPA framework as a real char), but settle
      // only once per burst instead of after every char. The old 6ms-per-char
      // sleep was unbounded (~23s for a 3831-char prompt); bursting drops the
      // serialized awaits ~32x. The post-typing composer-contains-text check
      // below is the safety net: if faster typing ever drops input, it returns
      // false and the send is gated exactly as before.
      const chars = Array.from(String(promptText));
      const BURST = 32;
      for (let i = 0; i < chars.length; i += BURST) {
        for (let j = i; j < i + BURST && j < chars.length; j += 1) {
          this.webContents.sendInputEvent({ type: 'char', keyCode: chars[j] });
        }
        await new Promise((r) => setTimeout(r, 4));
      }
      await new Promise((r) => setTimeout(r, 300));
      // Confirm the composer actually holds the FULL text — check prefix AND suffix so a
      // dropped middle/tail character (fast char events can drop them) is caught instead of
      // silently sending a truncated prompt. Fall back to a length check for safety.
      const head = String(promptText).slice(0, 12);
      const tail = String(promptText).slice(-12);
      const fullLen = String(promptText).length;
      const probe = `
        (() => {
          const sels = ${JSON.stringify(provider.inputSelectors || [])};
          const head = ${JSON.stringify(head)};
          const tail = ${JSON.stringify(tail)};
          const fullLen = ${JSON.stringify(fullLen)};
          for (const sel of sels) { const el = document.querySelector(sel); if (el) { const v = String(('value' in el) ? el.value : (el.innerText || el.textContent || '')); if (v.includes(head) && v.includes(tail) && v.length >= fullLen) return true; } }
          return false;
        })()`;
      let ok = await this.webContents.executeJavaScript(probe);
      if (ok === true) return true;

      // FALLBACK: trusted char events can land nowhere when the host window doesn't truly
      // hold OS focus (e.g. a background/offscreen smoke window) — the composer stays empty.
      // In that case set the value via the framework-correct native setter + dispatch input/
      // change + a keyup, which modern React/Svelte composers (qwen) DO accept. We only reach
      // this after trusted typing already failed, so it never weakens the trusted path; and
      // the post-injection re-check below still gates send if even this didn't land the text.
      await this.webContents.executeJavaScript(`
        (() => {
          const sels = ${JSON.stringify(provider.inputSelectors || [])};
          const text = ${JSON.stringify(String(promptText))};
          let node = null;
          for (const sel of sels) { for (const el of document.querySelectorAll(sel)) { try { const s = getComputedStyle(el); if (s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null && !el.disabled && !el.readOnly) { node = el; break; } } catch (_e) {} } if (node) break; }
          if (!node) return false;
          node.focus();
          if ('value' in node) {
            const proto = node instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const d = Object.getOwnPropertyDescriptor(proto, 'value');
            if (d && d.set) d.set.call(node, text); else node.value = text;
          } else {
            node.textContent = text;
          }
          node.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: text, inputType: 'insertText' }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
          node.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
          return true;
        })();
      `).catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
      ok = await this.webContents.executeJavaScript(probe);
      return ok === true;
    } catch (_error) {
      return false;
    }
  }

  // Click the send button with a TRUSTED mouse event (sendInputEvent) at its on-screen
  // center. Needed for providers (deepseek) whose send control is a div[role=button]
  // that a synthetic .click() doesn't truly activate. Returns true if a button was found.
  // Some providers (qwen) only RENDER + ENABLE the send button a beat after the composer
  // receives real text, so we POLL for an actionable button for a few seconds instead of
  // checking once — a single check raced the button into existence and fell back to Enter.
  async trustedClickSend(provider, { timeoutMs = 4000, pollMs = 250 } = {}) {
    if (typeof this.webContents.sendInputEvent !== 'function') return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        // Re-assert window focus right before clicking — during the button-appear poll the
        // host window can lose OS focus (provider redirects/loads), which makes a trusted
        // mouse click land on the wrong surface. Also fire an in-page .click() on the button
        // (focus-independent) so the send lands even when trusted coordinates miss.
        if (this.hostWindow) { try { this.hostWindow.show(); this.hostWindow.focus(); this.hostWindow.moveTop(); } catch (_e) {} }
        if (typeof this.webContents.focus === 'function') this.webContents.focus();
        const box = await this.webContents.executeJavaScript(`
          (() => {
            const sels = ${JSON.stringify(provider.sendSelectors || [])};
            const isAct = (el) => { try { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null && el.getAttribute('aria-disabled') !== 'true' && !el.disabled; } catch (_e) { return false; } };
            for (const sel of sels) { for (const el of document.querySelectorAll(sel)) { if (isAct(el)) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; } } }
            return null;
          })();
        `);
        if (box) {
          this.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
          this.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
          return true;
        }
      } catch (_error) {
        return false;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return false;
  }

  async sendPrompt({ provider, promptText }) {
    // Type with trusted input first (controlled SPA inputs need it; falls back to DOM
    // injection inside trustedTypeIntoComposer). Then let the FOCUS-INDEPENDENT in-page
    // ladder (el.click() reclick + dispatched Enter, inside the observation block below) be
    // the PRIMARY send path — it lands without the BrowserWindow holding OS focus, unlike a
    // trusted mouse click (which Chromium silently drops when focus is lost, electron#8273).
    // The trusted mouse click is NOT fired upfront anymore; the trusted-Enter escalation
    // (needsTrustedEnter -> trustedEnterAndRecheck) remains as the last-resort complement.
    const typedTrusted = await this.trustedTypeIntoComposer(provider, promptText);
    const trustedClicked = false;
    if (typedTrusted) {
      await new Promise((r) => setTimeout(r, 250));
    }
    const observation = await this.webContents.executeJavaScript(`
      (async () => {
        const alreadyTyped = ${typedTrusted ? 'true' : 'false'};
        const alreadySent = ${trustedClicked ? 'true' : 'false'};
        const inputSelectors = ${JSON.stringify(provider.inputSelectors || [])};
        const sendSelectors = ${JSON.stringify(provider.sendSelectors || [])};
        const responseCountSelector = ${JSON.stringify(provider.responseCountSelector || '')};
        const promptText = ${JSON.stringify(promptText)};
        const verificationTimeoutMs = ${JSON.stringify(this.verificationTimeoutMs)};
        const verificationPollMs = ${JSON.stringify(this.verificationPollMs)};
        const isActionable = (el) => {
          if (!el) return false;
          try {
            const style = window.getComputedStyle(el);
            const visible = style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
            const enabled = !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.readOnly;
            return visible && enabled;
          } catch (_error) { return false; }
        };
        // Prefer an ACTIONABLE match (visible + enabled) over the first node that merely
        // exists. grok renders a non-actionable <textarea> ahead of the real
        // [contenteditable] composer; typing into the former silently no-ops the send.
        const findFirst = (selectors) => {
          let fallback = null;
          for (const selector of selectors) {
            try {
              for (const node of document.querySelectorAll(selector)) {
                if (isActionable(node)) return { node, selector };
                if (!fallback) fallback = { node, selector };
              }
            } catch (_error) {}
          }
          return fallback;
        };
        const getComposerText = (node) => {
          if (!node) return '';
          if ('value' in node) return String(node.value || '');
          return String(node.innerText || node.textContent || '');
        };
        const countResponses = () => {
          if (!responseCountSelector) return 0;
          try { return document.querySelectorAll(responseCountSelector).length; }
          catch (_error) { return 0; }
        };
        const baselineResponseCount = countResponses();
        const inputMatch = findFirst(inputSelectors);
        if (!inputMatch) {
          return { ok: false, code: 'INPUT_NOT_FOUND', responseCountSelector, baselineResponseCount, finalResponseCount: baselineResponseCount };
        }
        const input = inputMatch.node;
        input.focus();
        // React/Vue track the input's value through their own state and ignore a raw
        // node.value assignment. Use the native prototype setter so the framework's
        // onChange fires, then dispatch a trusted-looking input event.
        const setNativeValue = (el, value) => {
          try {
            const proto = el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : (el instanceof HTMLInputElement ? HTMLInputElement.prototype : null);
            const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) { desc.set.call(el, value); return true; }
          } catch (_error) {}
          return false;
        };
        // Skip DOM-injection entirely if trusted typing already filled the composer —
        // re-writing here would clobber the value the framework just registered.
        if (alreadyTyped) {
          // no-op: composer already holds the prompt via trusted keyboard input
        } else if ('value' in input) {
          if (!setNativeValue(input, '')) input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          if (!setNativeValue(input, promptText)) input.value = promptText;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          // Rich contenteditable editors (ProseMirror/TipTap on z.ai, Lexical on meta,
          // Manus TipTap) keep an internal document model and IGNORE a raw textContent
          // assignment. Drive their real input pipeline: focus, select-all+delete, then
          // execCommand('insertText') (fires native beforeinput->transaction). Fall back
          // to a synthetic beforeinput, then textContent, for plain contenteditables.
          input.focus();
          let inserted = false;
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(input);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete', false, null);
            inserted = document.execCommand('insertText', false, promptText);
          } catch (_error) {}
          if (!inserted || !(input.innerText || input.textContent || '').includes(promptText.slice(0, 12))) {
            try {
              const dt = new DataTransfer();
              dt.setData('text/plain', promptText);
              input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: promptText, dataTransfer: dt, bubbles: true, cancelable: true, composed: true }));
            } catch (_error) {}
          }
          if (!(input.innerText || input.textContent || '').includes(promptText.slice(0, 12))) {
            input.textContent = promptText;
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText }));
          }
          // qwen renders/enables its send button a beat AFTER the DOM 'input' event lands.
          // Give the framework one settle tick to register the value and flip the button
          // enabled BEFORE we start polling — without this the first poll iteration sees a
          // still-disabled button and the click can race ahead of the enable (the 1/3
          // inpage-click miss). Cheap (~120ms) and only on the DOM-injection path.
          await new Promise((resolve) => setTimeout(resolve, 120));
          // Re-inject if the framework discarded the value (composer unexpectedly empty
          // after the settle) — a single retry makes the typed state deterministic.
          if (getComposerText(input).trim() === '') {
            try {
              if ('value' in input) {
                if (!setNativeValue(input, promptText)) input.value = promptText;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                input.focus();
                if (!document.execCommand('insertText', false, promptText)) {
                  input.textContent = promptText;
                  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: promptText }));
                }
              }
            } catch (_error) {}
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
        }
        // Wait for a send button to become ENABLED before deciding. React-controlled
        // composers (deepseek, qwen) enable their send button only after the framework
        // registers the typed value, which can take well over 50ms. Poll up to ~2.5s for
        // an actionable send control; only fall back to Enter if none appears.
        // Use the FULL actionability predicate for send buttons (visible + offsetParent +
        // enabled), not just disabled/aria-disabled — a decorative/wrong [class*=send] icon
        // wrapper passes the weak check and gets clicked, no-opping the send.
        const isClickable = (n) => isActionable(n);
        // Fast success signal for qwen: the composer clears the instant the send lands,
        // seconds before the response node mounts (responseCountSelector path is slow).
        // Tight-poll the composer for a clear over ~1.2s after an in-page action.
        const composerClearedWithin = async (ms) => {
          const until = Date.now() + ms;
          while (Date.now() < until) {
            if (getComposerText(input).trim() === '') return true;
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
          return getComposerText(input).trim() === '';
        };
        let method = 'enter';
        let sendSelector = null;
        let needsTrustedEnter = false;
        // The caller may have attempted a TRUSTED mouse click (alreadySent). That path is
        // focus-dependent and silently no-ops when the window lacks OS focus — so we must NOT
        // treat it as proof. Only skip the in-page ladder if the composer ALREADY cleared
        // (i.e. the trusted click genuinely landed). Otherwise run the focus-INDEPENDENT
        // in-page ladder regardless, which is what reliably submits on qwen.
        const alreadyLanded = alreadySent && (await composerClearedWithin(300));
        if (alreadyLanded) {
          method = 'trusted_click';
        } else {
          // A real send button, when it exists, renders within ~1s of the value landing. Poll
          // ~1.2s (was 2.5s) so no-button providers (kimi/manus, Enter-only) fall through to
          // the Enter path fast instead of burning 2.5s every send.
          let sendMatch = null;
          for (let i = 0; i < 15; i++) {
            const m = findFirst(sendSelectors);
            if (m && isClickable(m.node)) { sendMatch = m; break; }
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
          if (sendMatch && isClickable(sendMatch.node)) {
            sendMatch.node.click();
            method = 'click';
            sendSelector = sendMatch.selector;
            // The button may have enabled the same tick we clicked, so the first click can
            // no-op. composerClearedWithin returns the INSTANT the composer empties (60ms
            // granularity), so the success path is fast; these are just upper bounds before
            // escalating to the next focus-independent rung. This closes the 1/3 click race.
            if (!(await composerClearedWithin(500))) {
              const m2 = findFirst(sendSelectors);
              if (m2 && isClickable(m2.node)) { try { m2.node.click(); } catch (_error) {} }
              if (!(await composerClearedWithin(350))) {
                const enterInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
                input.dispatchEvent(new KeyboardEvent('keydown', enterInit));
                input.dispatchEvent(new KeyboardEvent('keypress', enterInit));
                input.dispatchEvent(new KeyboardEvent('keyup', enterInit));
                await composerClearedWithin(300);
              }
            }
          } else {
            // No actionable send button — fall back to a focus-independent in-page Enter on
            // the focused composer. Synthetic KeyboardEvents are untrusted, but many SPA
            // composers (Vue/React keydown.enter handlers) act on them when the event crosses
            // shadow boundaries (composed=true makes qwen submit). If the composer still does
            // not clear, the caller escalates to a trusted Enter via sendInputEvent.
            input.focus();
            const enterInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
            input.dispatchEvent(new KeyboardEvent('keydown', enterInit));
            input.dispatchEvent(new KeyboardEvent('keypress', enterInit));
            input.dispatchEvent(new KeyboardEvent('keyup', enterInit));
            await composerClearedWithin(400);
            needsTrustedEnter = true;
          }
        }

        const deadline = Date.now() + verificationTimeoutMs;
        let finalResponseCount = countResponses();
        let composerTextAfterSend = getComposerText(input);
        while (Date.now() < deadline) {
          finalResponseCount = countResponses();
          composerTextAfterSend = getComposerText(input);
          if ((responseCountSelector && finalResponseCount > baselineResponseCount) || composerTextAfterSend.trim() === '') {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, verificationPollMs));
        }

        // If we clicked a candidate send button but the composer never cleared and no new
        // response appeared, the click hit the wrong/decorative element (e.g. a [class*=send]
        // icon wrapper). Ask the caller to try a trusted Enter instead.
        // A REAL send is proven by a new response appearing. Composer-clear alone is NOT
        // proof: some composers (deepseek) clear on a synthetic Enter that inserts a
        // newline / no-ops without actually sending, so clearing must not suppress the
        // trusted-Enter fallback.
        const responseAppeared = responseCountSelector && finalResponseCount > baselineResponseCount;
        const composerCleared = composerTextAfterSend.trim() === '';
        if (responseAppeared) {
          // The message went through — never fire a trusted Enter on top (avoids duplicate).
          needsTrustedEnter = false;
        } else if (method === 'click' && !composerCleared) {
          // A click that didn't land hit the wrong element; ask for a trusted Enter.
          needsTrustedEnter = true;
        }
        // else (synthetic Enter path): keep needsTrustedEnter = true so the caller sends a
        // trusted Enter — synthetic Enter alone is unreliable for many SPA composers.

        return {
          ok: true,
          method,
          needsTrustedEnter,
          inputSelector: inputMatch.selector,
          sendSelector,
          responseCountSelector,
          baselineResponseCount,
          finalResponseCount,
          composerTextAfterSend
        };
      })();
    `);

    // If the in-page synthetic Enter likely won't register (SPA composer, no send
    // button), dispatch a trusted Enter through Chromium and re-check verification.
    let observationToVerify = observation;
    if (observation && observation.ok && observation.needsTrustedEnter
        && typeof this.webContents.sendInputEvent === 'function') {
      observationToVerify = await this.trustedEnterAndRecheck(provider, observation);
    }
    const result = verifySendObservation(observationToVerify);

    if (!result.verified && this.diagnosticsStore) {
      this.diagnosticsStore.add({
        providerId: provider.id,
        code: result.code || 'SEND_NOT_VERIFIED',
        message: 'Send controller could not verify prompt send.',
        details: result
      });
    }
    return result;
  }

  // Dispatch a trusted Enter via Chromium (sendInputEvent), then re-poll the composer
  // and response count so verification reflects the trusted keypress, not the ignored
  // synthetic one.
  async trustedEnterAndRecheck(provider, observation) {
    // Focus the EXACT composer that received the text (not the page / a decoy node),
    // then dispatch a trusted Enter. Verifying against the same composer is what makes
    // the composer_clear signal meaningful.
    const usedSelector = observation && observation.inputSelector;
    try {
      await this.webContents.executeJavaScript(`
        (() => {
          const sel = ${JSON.stringify(usedSelector || '')};
          const isAct = (el) => { try { const s=getComputedStyle(el); return s.display!=='none'&&s.visibility!=='hidden'&&el.offsetParent!==null&&!el.disabled&&!el.readOnly; } catch(e){return false;} };
          let node = null;
          if (sel) { for (const n of document.querySelectorAll(sel)) { if (isAct(n)) { node = n; break; } if (!node) node = n; } }
          if (node && node.focus) node.focus();
          return !!node;
        })();
      `);
      // The provider runs in a CHILD WebContentsView. A DOM node.focus() does NOT give
      // the view OS-level input focus, and sendInputEvent is dropped by Chromium unless
      // the WINDOW holds OS focus (electron#8273). Raise+focus the host window first,
      // then the view — this is what makes Enter-only composers (qwen, Vue) submit.
      if (this.hostWindow) {
        try { this.hostWindow.show(); this.hostWindow.focus(); this.hostWindow.moveTop(); } catch (_e) {}
      }
      if (typeof this.webContents.focus === 'function') this.webContents.focus();
      this.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      this.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      this.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    } catch (_error) {
      return observation;
    }
    const recheck = await this.webContents.executeJavaScript(`
      (async () => {
        const inputSelectors = ${JSON.stringify(provider.inputSelectors || [])};
        const usedSelector = ${JSON.stringify(usedSelector || '')};
        const responseCountSelector = ${JSON.stringify(provider.responseCountSelector || '')};
        const verificationTimeoutMs = ${JSON.stringify(this.verificationTimeoutMs)};
        const verificationPollMs = ${JSON.stringify(this.verificationPollMs)};
        const isAct = (el) => { try { const s=getComputedStyle(el); return s.display!=='none'&&s.visibility!=='hidden'&&el.offsetParent!==null&&!el.disabled&&!el.readOnly; } catch(e){return false;} };
        const findFirst = (selectors) => {
          // Prefer the exact composer used for the send, then an actionable match.
          const ordered = usedSelector ? [usedSelector, ...selectors] : selectors;
          for (const selector of ordered) {
            try { for (const n of document.querySelectorAll(selector)) { if (isAct(n)) return n; } } catch (_error) {}
          }
          for (const selector of ordered) {
            try { const node = document.querySelector(selector); if (node) return node; } catch (_error) {}
          }
          return null;
        };
        const getComposerText = (node) => {
          if (!node) return '';
          if ('value' in node) return String(node.value || '');
          return String(node.innerText || node.textContent || '');
        };
        const countResponses = () => {
          if (!responseCountSelector) return 0;
          try { return document.querySelectorAll(responseCountSelector).length; } catch (_error) { return 0; }
        };
        const input = findFirst(inputSelectors);
        const baseline = ${JSON.stringify(Number(observation.baselineResponseCount || 0))};
        const deadline = Date.now() + verificationTimeoutMs;
        let finalResponseCount = countResponses();
        let composerTextAfterSend = getComposerText(input);
        while (Date.now() < deadline) {
          finalResponseCount = countResponses();
          composerTextAfterSend = getComposerText(input);
          if ((responseCountSelector && finalResponseCount > baseline) || composerTextAfterSend.trim() === '') break;
          await new Promise((resolve) => setTimeout(resolve, verificationPollMs));
        }
        return { finalResponseCount, composerTextAfterSend };
      })();
    `);
    return {
      ...observation,
      method: 'trusted_enter',
      finalResponseCount: recheck.finalResponseCount,
      composerTextAfterSend: recheck.composerTextAfterSend
    };
  }
}

module.exports = {
  SendController,
  verifySendObservation
};
