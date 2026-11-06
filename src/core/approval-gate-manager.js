'use strict';

const APPROVAL_GATES = Object.freeze({
  LIVE_PROVIDER_DOCTOR: {
    id: 'LIVE_PROVIDER_DOCTOR',
    risk: 'high',
    live: true,
    env: 'AI_TEAM_V3_CONFIRM_SAFE_SESSION',
    description: 'Open or attach to one live provider session for no-prompt selector verification.'
  },
  ONE_PROVIDER_SMOKE: {
    id: 'ONE_PROVIDER_SMOKE',
    risk: 'high',
    live: true,
    env: 'AI_TEAM_V3_CONFIRM_SAFE_SESSION',
    description: 'Send one tiny prompt to qwen or kimi after Selector Doctor passes.'
  },
  TWO_PROVIDER_SMOKE: {
    id: 'TWO_PROVIDER_SMOKE',
    risk: 'high',
    live: true,
    env: 'AI_TEAM_V3_APPROVE_TWO_PROVIDER_SMOKE',
    description: 'Run a two-provider live smoke after one-provider evidence exists.'
  },
  MULTI_PROVIDER_RUN: {
    id: 'MULTI_PROVIDER_RUN',
    risk: 'high',
    live: true,
    env: 'AI_TEAM_V3_APPROVE_MULTI_PROVIDER_RUN',
    description: 'Run any live room with more than two providers.'
  },
  LIVE_DISCUSSION: {
    id: 'LIVE_DISCUSSION',
    risk: 'high',
    live: true,
    env: 'AI_TEAM_V3_APPROVE_DISCUSSION',
    description: 'Open a live multi-provider discussion room after static evidence gates pass.'
  },
  CLAUDE_LIVE: {
    id: 'CLAUDE_LIVE',
    risk: 'high',
    live: true,
    forbiddenByDefault: true,
    env: 'AI_TEAM_V3_APPROVE_CLAUDE_LIVE',
    description: 'Use Claude in live provider automation.'
  },
  CHATGPT_LIVE: {
    id: 'CHATGPT_LIVE',
    risk: 'high',
    live: true,
    forbiddenByDefault: true,
    env: 'AI_TEAM_V3_APPROVE_CHATGPT_LIVE',
    description: 'Use ChatGPT in live provider automation.'
  },
  PERPLEXITY_LIVE: {
    id: 'PERPLEXITY_LIVE',
    risk: 'high',
    live: true,
    forbiddenByDefault: true,
    env: 'AI_TEAM_V3_APPROVE_PERPLEXITY_LIVE',
    description: 'Use Perplexity in live provider automation.'
  },
  FULL_7_PROVIDER_LIVE: {
    id: 'FULL_7_PROVIDER_LIVE',
    risk: 'high',
    live: true,
    forbiddenByDefault: true,
    env: 'AI_TEAM_V3_APPROVE_FULL_7_PROVIDER_LIVE',
    description: 'Run all seven providers live.'
  },
  LONG_PROMPT_SEND: {
    id: 'LONG_PROMPT_SEND',
    risk: 'medium',
    live: false,
    env: 'AI_TEAM_V3_APPROVE_LONG_PROMPT_SEND',
    description: 'Send a prompt beyond normal low-risk size.'
  },
  PROVIDER_RELOAD: {
    id: 'PROVIDER_RELOAD',
    risk: 'medium',
    live: true,
    env: 'AI_TEAM_V3_APPROVE_PROVIDER_RELOAD',
    description: 'Reload a persistent provider web session.'
  },
  SESSION_RESET: {
    id: 'SESSION_RESET',
    risk: 'high',
    live: true,
    env: 'AI_TEAM_V3_APPROVE_SESSION_RESET',
    description: 'Reset a provider session or force a new chat.'
  },
  OFFLINE_FAKE_LADDER: {
    id: 'OFFLINE_FAKE_LADDER',
    risk: 'low',
    live: false,
    description: 'Run fake-provider ladder tests without contacting providers.'
  },
  DASHBOARD_VIEW: {
    id: 'DASHBOARD_VIEW',
    risk: 'low',
    live: false,
    description: 'Open the local dashboard without provider sessions.'
  }
});

function isTruthy(value) {
  return ['1', 'true', 'yes', 'approved'].includes(String(value || '').toLowerCase());
}

function listApprovalGates() {
  return Object.values(APPROVAL_GATES).map((gate) => ({ ...gate }));
}

class ApprovalGateManager {
  constructor({ env = process.env, allowForbiddenLive = false } = {}) {
    this.env = env;
    this.allowForbiddenLive = allowForbiddenLive;
  }

  evaluate(gateId, { env = this.env, uiApproved = false, offline = false } = {}) {
    const gate = Object.hasOwn(APPROVAL_GATES, gateId) ? APPROVAL_GATES[gateId] : null;
    if (!gate) {
      return {
        ok: false,
        gateId,
        code: 'UNKNOWN_APPROVAL_GATE',
        risk: 'unknown',
        live: false,
        message: `Unknown approval gate: ${gateId}`
      };
    }

    if (gate.forbiddenByDefault && this.allowForbiddenLive !== true) {
      return {
        ok: false,
        gateId,
        code: 'FORBIDDEN_BY_DEFAULT',
        risk: gate.risk,
        live: gate.live,
        requiredEnv: gate.env,
        message: `${gateId} is forbidden by default.`
      };
    }

    if (gate.risk === 'low' && gate.live === false) {
      return {
        ok: true,
        gateId,
        code: 'APPROVED_LOW_RISK_OFFLINE',
        risk: gate.risk,
        live: gate.live,
        message: `${gateId} can run offline.`
      };
    }

    if (offline === true && gate.live === false && gate.risk === 'low') {
      return {
        ok: true,
        gateId,
        code: 'APPROVED_OFFLINE',
        risk: gate.risk,
        live: gate.live,
        message: `${gateId} approved for offline execution.`
      };
    }

    if (uiApproved === true || (gate.env && isTruthy(env[gate.env]))) {
      return {
        ok: true,
        gateId,
        code: gate.live ? 'APPROVED_HUMAN_CONFIRMED' : 'APPROVED_EXPLICIT',
        risk: gate.risk,
        live: gate.live,
        requiredEnv: gate.env,
        message: `${gateId} has explicit approval.`
      };
    }

    return {
      ok: false,
      gateId,
      code: gate.live ? 'BLOCKED_HUMAN_CONFIRMATION_REQUIRED' : 'BLOCKED_APPROVAL_REQUIRED',
      risk: gate.risk,
      live: gate.live,
      requiredEnv: gate.env,
      message: `${gateId} requires explicit approval${gate.env ? ` via ${gate.env}=1` : ''}.`
    };
  }

  assertAllowed(gateId, options = {}) {
    const result = this.evaluate(gateId, options);
    if (!result.ok) {
      const error = new Error(result.message);
      error.code = result.code;
      error.gate = result;
      throw error;
    }
    return result;
  }
}

module.exports = {
  APPROVAL_GATES,
  ApprovalGateManager,
  isTruthy,
  listApprovalGates
};
