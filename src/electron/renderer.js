'use strict';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text != null) {
    node.textContent = text;
  }
  return node;
}

function statusClass(status) {
  if (/PASS|READY|OK|APPROVED/i.test(status)) {
    return 'ok';
  }
  if (/BLOCK|WAIT|HUMAN|GATED|NOT_RUN/i.test(status)) {
    return 'warn';
  }
  if (/FAIL|ERROR|FORBIDDEN/i.test(status)) {
    return 'bad';
  }
  return 'blue';
}

function renderKv(pairs) {
  const box = el('div', 'kv');
  for (const [key, value] of pairs) {
    box.appendChild(el('span', '', key));
    box.appendChild(el('span', '', String(value == null ? 'n/a' : value)));
  }
  return box;
}

function renderProviderCard(provider) {
  const card = el('section', 'card provider-card');
  const title = el('h3', '', provider.name);
  const status = el('span', `status ${statusClass(provider.status)}`, provider.status);
  card.appendChild(title);
  card.appendChild(status);
  card.appendChild(renderKv([
    ['Provider id', provider.id],
    ['Mode', provider.liveEnabled ? 'human-gated live candidate' : 'offline/fake only'],
    ['Host', provider.urlHost],
    ['Prompt budget', provider.maxPromptChars],
    ['Stability', `${provider.stabilityMs}ms`],
    ['Selectors OK', provider.health.selectorsOk],
    ['Consecutive failures', provider.health.consecutiveFailures],
    ['Disabled', provider.health.disabledForRun]
  ]));
  const button = el('button', 'blocked-button', 'Live open blocked');
  button.type = 'button';
  button.disabled = true;
  card.appendChild(button);
  return card;
}

function renderTable(headers, rows) {
  const table = el('table', 'table');
  const thead = el('thead');
  const tr = el('tr');
  for (const header of headers) {
    tr.appendChild(el('th', '', header));
  }
  thead.appendChild(tr);
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const row of rows) {
    const rowNode = el('tr');
    for (const cell of row) {
      rowNode.appendChild(el('td', '', cell));
    }
    tbody.appendChild(rowNode);
  }
  if (rows.length === 0) {
    const empty = el('tr');
    const cell = el('td', 'muted', 'No records.');
    cell.colSpan = headers.length;
    empty.appendChild(cell);
    tbody.appendChild(empty);
  }
  table.appendChild(tbody);
  return table;
}

function renderConversation(conversation) {
  const panel = el('section', 'panel');
  panel.appendChild(el('h2', '', 'Conversation (answers + AI thinking)'));
  if (!conversation || conversation.length === 0) {
    panel.appendChild(el('p', 'muted', 'No conversation yet. Answers appear here; each AI’s thinking shows in its own collapsible block.'));
    return panel;
  }
  for (const turn of conversation) {
    if (turn.role === 'user') {
      const u = el('div', 'conv-turn conv-user');
      u.appendChild(el('span', 'conv-who', 'You'));
      u.appendChild(el('div', 'conv-answer', turn.text));
      panel.appendChild(u);
      continue;
    }
    const t = el('div', 'conv-turn conv-ai');
    t.appendChild(el('span', 'conv-who', turn.providerName || turn.providerId));
    // The ANSWER (what goes to the public transcript).
    t.appendChild(el('div', 'conv-answer', turn.answer));
    // The REASONING/thinking, in its OWN collapsible block, visually distinct from the
    // answer so there is no mixup (this is the AI’s thinking, not its reply).
    if (turn.reasoning && turn.reasoning.trim()) {
      const details = el('details', 'conv-reasoning');
      const summary = el('summary', '', '🧠 What ' + (turn.providerName || turn.providerId) + ' is thinking');
      details.appendChild(summary);
      details.appendChild(el('div', 'conv-reasoning-body', turn.reasoning));
      t.appendChild(details);
    }
    panel.appendChild(t);
  }
  return panel;
}

// Live discussion panel: pick AIs, type a question, set rounds, press Start, then watch
// each AI's answer (and its separate 🧠 thinking) stream in live as the debate runs.
function renderDiscussionPanel(state) {
  const panel = el('section', 'panel discussion-panel');
  panel.appendChild(el('h2', '', 'Start a live discussion'));
  panel.appendChild(el('p', 'muted', 'The AIs see each other’s answers each round and converge. Each answer shows with its own thinking block.'));

  const controls = el('div', 'disc-controls');
  const prompt = el('textarea', 'disc-prompt');
  prompt.placeholder = 'Ask the team something hard… (e.g. What is the best thing to invest my money in?)';
  prompt.rows = 2;
  controls.appendChild(prompt);

  // Provider checkboxes — only live-eligible providers; default the reliable ones on.
  const RELIABLE = new Set(['gemini', 'grok', 'qwen', 'kimi', 'deepseek']);
  const picks = el('div', 'disc-picks');
  const checkboxes = [];
  for (const provider of state.providers) {
    if (!provider.liveEnabled) continue;
    const label = el('label', 'disc-pick');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = provider.id;
    cb.checked = RELIABLE.has(provider.id);
    label.appendChild(cb);
    label.appendChild(el('span', '', provider.name));
    picks.appendChild(label);
    checkboxes.push(cb);
  }
  controls.appendChild(picks);

  const row = el('div', 'disc-row');
  const roundsWrap = el('label', 'disc-rounds');
  roundsWrap.appendChild(el('span', 'muted', 'Rounds'));
  const rounds = document.createElement('input');
  rounds.type = 'number';
  rounds.min = '1';
  rounds.max = '20';
  rounds.value = '3';
  roundsWrap.appendChild(rounds);
  row.appendChild(roundsWrap);

  const startBtn = el('button', 'disc-start', 'Start discussion');
  startBtn.type = 'button';
  row.appendChild(startBtn);
  const statusLine = el('span', 'disc-status muted', 'Idle.');
  row.appendChild(statusLine);
  controls.appendChild(row);
  panel.appendChild(controls);

  const live = el('div', 'disc-live');
  live.appendChild(el('p', 'muted', 'Conversation will appear here.'));
  panel.appendChild(live);

  let unsubscribers = [];
  const cleanup = () => { unsubscribers.forEach((u) => { try { u(); } catch (_e) {} }); unsubscribers = []; };

  function appendTurn(turn) {
    if (live.firstChild && live.firstChild.classList && live.firstChild.classList.contains('muted')) {
      live.innerHTML = '';
    }
    const t = el('div', 'conv-turn conv-ai');
    t.appendChild(el('span', 'conv-who', turn.providerName || turn.providerId));
    t.appendChild(el('div', 'conv-answer', turn.answer));
    if (turn.reasoning && turn.reasoning.trim()) {
      const details = el('details', 'conv-reasoning');
      details.appendChild(el('summary', '', '🧠 What ' + (turn.providerName || turn.providerId) + ' is thinking'));
      details.appendChild(el('div', 'conv-reasoning-body', turn.reasoning));
      t.appendChild(details);
    }
    live.appendChild(t);
    live.scrollTop = live.scrollHeight;
  }

  startBtn.addEventListener('click', async () => {
    if (!window.aiTeamV3 || !window.aiTeamV3.startDiscussion) {
      statusLine.textContent = 'Discussion bridge unavailable.';
      return;
    }
    const roster = checkboxes.filter((c) => c.checked).map((c) => c.value);
    const promptText = prompt.value.trim();
    if (!promptText) { statusLine.textContent = 'Type a question first.'; return; }
    if (roster.length < 2) { statusLine.textContent = 'Pick at least two AIs.'; return; }

    cleanup();
    live.innerHTML = '';
    live.appendChild(el('p', 'muted', 'Opening providers…'));
    startBtn.disabled = true;
    statusLine.textContent = 'Running…';

    unsubscribers.push(window.aiTeamV3.onDiscussionEvent('discussion:status', (p) => {
      statusLine.textContent = p.joined ? `joined ${p.providerId}` : `skipped ${p.providerId} (${p.reason})`;
    }));
    unsubscribers.push(window.aiTeamV3.onDiscussionEvent('discussion:turn', appendTurn));
    unsubscribers.push(window.aiTeamV3.onDiscussionEvent('discussion:done', (p) => {
      statusLine.textContent = `Done — ${p.turns} turns over ${p.rounds} rounds (${p.providers} AIs).`;
      startBtn.disabled = false;
      cleanup();
    }));

    try {
      const result = await window.aiTeamV3.startDiscussion({
        prompt: promptText,
        roster,
        rounds: Number(rounds.value) || 3,
        approval: { confirmed: true }
      });
      if (!result || result.ok === false) {
        statusLine.textContent = `Could not start: ${(result && (result.message || result.code)) || 'unknown error'}`;
        startBtn.disabled = false;
        cleanup();
      }
    } catch (err) {
      statusLine.textContent = 'Start failed.';
      startBtn.disabled = false;
      cleanup();
    }
  });

  return panel;
}

function renderDashboard(state) {
  const root = document.getElementById('app');
  root.innerHTML = '';

  const aside = el('aside');
  aside.appendChild(el('h1', '', 'AI Team V3'));
  aside.appendChild(el('p', 'muted', 'Offline control dashboard. It does not contact providers on startup.'));
  aside.appendChild(el('h2', '', 'Current Status'));
  aside.appendChild(el('span', `status ${statusClass(state.currentStatus)}`, state.currentStatus));
  aside.appendChild(el('h2', '', 'Final Status'));
  aside.appendChild(el('span', `status ${statusClass(state.finalStatus)}`, state.finalStatus));
  aside.appendChild(el('h2', '', 'Safe Qwen Doctor'));
  aside.appendChild(el('div', 'command', "Set-Location -LiteralPath 'C:\\path\\to\\ai-team-v3'\nnpm run doctor:provider -- qwen"));
  aside.appendChild(el('h2', '', 'Live Smoke Gate'));
  aside.appendChild(el('div', 'command', "$env:AI_TEAM_V3_LIVE='1'\n$env:AI_TEAM_V3_LIVE_PROVIDER='qwen'\n$env:AI_TEAM_V3_CONFIRM_SAFE_SESSION='1'\nnpm run smoke:one-provider"));

  const main = el('main');
  const top = el('section', 'grid top-grid');
  top.appendChild(stat('Run status', state.runStatus));
  top.appendChild(stat('Live auto-start', state.liveAutoStart ? 'ON' : 'OFF'));
  top.appendChild(stat('Mode', state.settings.mode));
  top.appendChild(stat('Trace files', state.traces.length));
  main.appendChild(top);

  const providers = el('section', 'grid provider-grid');
  for (const provider of state.providers) {
    providers.appendChild(renderProviderCard(provider));
  }
  main.appendChild(providers);

  // Live discussion: start a real multi-AI debate from inside the app and watch it stream.
  main.appendChild(renderDiscussionPanel(state));

  // Conversation: each AI's answer + its own thinking block (separate, collapsible).
  main.appendChild(renderConversation(state.conversation));

  const lower = el('section', 'grid main-grid');
  const left = el('div', 'grid');
  const right = el('div', 'grid');

  const gates = el('section', 'panel');
  gates.appendChild(el('h2', '', 'Approval Gates'));
  gates.appendChild(renderTable(['Gate', 'Risk', 'Live', 'Decision'], state.approvalGates.map((gate) => [
    gate.id,
    gate.risk,
    String(gate.live),
    gate.evaluation.code
  ])));
  left.appendChild(gates);

  const reports = el('section', 'panel');
  reports.appendChild(el('h2', '', 'Reports'));
  reports.appendChild(renderTable(['Report', 'Status', 'Path'], state.reports.map((report) => [
    report.label,
    report.status,
    report.path
  ])));
  left.appendChild(reports);

  const health = el('section', 'panel');
  health.appendChild(el('h2', '', 'Provider Health'));
  health.appendChild(renderTable(['Provider', 'Available', 'Logged in', 'Failures', 'Rate limit', 'Challenge'], state.providers.map((provider) => [
    provider.id,
    String(provider.health.available),
    provider.health.loggedIn,
    String(provider.health.consecutiveFailures),
    String(provider.health.rateLimitDetected),
    String(provider.health.challengeDetected)
  ])));
  right.appendChild(health);

  const traces = el('section', 'panel');
  traces.appendChild(el('h2', '', 'Trace Summary'));
  traces.appendChild(renderTable(['Trace', 'Provider', 'Status'], state.traces.map((trace) => [
    trace.file,
    trace.providerId,
    trace.status
  ])));
  right.appendChild(traces);

  const statusFiles = el('section', 'panel');
  statusFiles.appendChild(el('h2', '', 'Status Files'));
  statusFiles.appendChild(el('pre', '', state.statusFiles.currentStatusPreview || 'No CURRENT_STATUS.md found.'));
  right.appendChild(statusFiles);

  lower.appendChild(left);
  lower.appendChild(right);
  main.appendChild(lower);

  root.appendChild(aside);
  root.appendChild(main);
}

function stat(label, value) {
  const node = el('section', 'panel stat');
  node.appendChild(el('span', 'muted', label));
  node.appendChild(el('strong', '', value));
  return node;
}

window.addEventListener('DOMContentLoaded', async () => {
  if (!window.aiTeamV3 || !window.aiTeamV3.getDashboardState) {
    return;
  }
  const state = await window.aiTeamV3.getDashboardState();
  renderDashboard(state);
});
