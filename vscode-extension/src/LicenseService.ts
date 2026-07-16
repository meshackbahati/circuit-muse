/**
 * License gate for the Velxio VS Code extension.
 *
 * Responsibilities:
 *   - Persist the license key in `ExtensionContext.secrets` (VS Code's
 *     OS-keychain-backed secret storage). Never in workspace settings —
 *     users commit those to git.
 *   - Validate the key against `<apiBase>/api/pro/license/validate`
 *     before every compile/run. The hot-path call is rate-limited to
 *     60/min/key server-side; this client caches the last successful
 *     result in memory (not on disk) for 60s to avoid hammering the
 *     endpoint during a tight compile/run loop without giving any
 *     offline window.
 *   - Drive the deep-link OAuth handshake: generate a state nonce,
 *     hold it in workspace state, accept the redirected URI back from
 *     velxio.dev, swap nonce → key.
 *
 * Online-only by design (per paid-clients/phase-01 spec). A network
 * failure throws OfflineError; the extension surfaces a "Velxio requires
 * an internet connection" toast.
 */

import * as vscode from 'vscode';

// ── Types ─────────────────────────────────────────────────────────────────

export type LicensePlan = 'free' | 'personal' | 'trial' | 'pro' | 'pro_max' | 'commercial';

export type Entitlements = {
  web_pro: boolean;
  desktop: boolean;
  vscode_ext: boolean;
  agent_ai: boolean;
  cloud_projects: boolean;
};

export type ValidationResult = {
  valid: boolean;
  plan?: LicensePlan | null;
  status?: string | null;
  trial_ends_at?: string | null;
  subscription_period_end?: string | null;
  entitlements: Partial<Entitlements>;
  reason_code?:
    | 'not_found'
    | 'revoked'
    | 'suspended'
    | 'expired'
    | 'trial_expired'
    | 'malformed'
    | null;
};

export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super(
      'Velxio requires an internet connection to validate your license.' +
        (cause ? ` (${String(cause)})` : ''),
    );
    this.name = 'OfflineError';
  }
}

export class EntitlementError extends Error {
  result: ValidationResult;
  constructor(message: string, result: ValidationResult) {
    super(message);
    this.name = 'EntitlementError';
    this.result = result;
  }
}

// ── Storage keys ──────────────────────────────────────────────────────────

const SECRET_LICENSE_KEY = 'velxio.licenseKey';
const STATE_PENDING_NONCE = 'velxio.auth.pendingNonce';
const STATE_PENDING_NONCE_EXP = 'velxio.auth.pendingNonceExp';
const NONCE_TTL_MS = 5 * 60 * 1000;

const CACHE_TTL_MS = 60_000;

// ── Service ───────────────────────────────────────────────────────────────

export class LicenseService {
  private context: vscode.ExtensionContext;
  private memoryCache: { result: ValidationResult; expiresAt: number } | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  // ── Config ──────────────────────────────────────────────────────────────

  private apiBase(): string {
    const cfg = vscode.workspace.getConfiguration('velxio');
    const raw = (cfg.get<string>('licenseApiBase') ?? 'https://velxio.dev').trim();
    return raw.replace(/\/+$/, '');
  }

  // ── Key storage ─────────────────────────────────────────────────────────

  async getKey(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_LICENSE_KEY);
  }

  async setKey(key: string): Promise<void> {
    await this.context.secrets.store(SECRET_LICENSE_KEY, key.trim());
    this.invalidateCache();
  }

  async clearKey(): Promise<void> {
    await this.context.secrets.delete(SECRET_LICENSE_KEY);
    this.invalidateCache();
  }

  invalidateCache(): void {
    this.memoryCache = null;
  }

  // ── Nonce (deep-link OAuth) ─────────────────────────────────────────────

  async beginSignIn(): Promise<{ state: string; signInUrl: string }> {
    const state = this.randomNonce();
    await this.context.globalState.update(STATE_PENDING_NONCE, state);
    await this.context.globalState.update(STATE_PENDING_NONCE_EXP, Date.now() + NONCE_TTL_MS);
    const signInUrl = `${this.apiBase()}/auth/vscode?state=${encodeURIComponent(state)}`;
    return { state, signInUrl };
  }

  async completeSignIn(token: string | null, state: string | null): Promise<ValidationResult> {
    if (!token || !state) {
      throw new Error('Sign-in callback is missing token or state.');
    }
    const pending = this.context.globalState.get<string>(STATE_PENDING_NONCE);
    const pendingExp = this.context.globalState.get<number>(STATE_PENDING_NONCE_EXP) ?? 0;
    // Always clear the pending nonce so a replay can't succeed even if
    // verification below throws and the user retries.
    await this.context.globalState.update(STATE_PENDING_NONCE, undefined);
    await this.context.globalState.update(STATE_PENDING_NONCE_EXP, undefined);

    if (!pending || pending !== state) {
      throw new Error(
        'Sign-in nonce mismatch. The link may have been opened in a different VS Code window, or it has expired. Try signing in again.',
      );
    }
    if (Date.now() > pendingExp) {
      throw new Error('Sign-in link expired. Try signing in again.');
    }

    await this.setKey(token);
    return await this.validate({ skipCache: true });
  }

  private randomNonce(): string {
    // Browser-style crypto isn't available in the extension host on all
    // VS Code versions; fall back to Math.random + timestamp which is
    // fine for an OAuth state (single-use, server doesn't trust it).
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    if (g.crypto?.randomUUID) return g.crypto.randomUUID();
    return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  // ── Validate ────────────────────────────────────────────────────────────

  async validate(opts: { skipCache?: boolean } = {}): Promise<ValidationResult> {
    if (!opts.skipCache && this.memoryCache && Date.now() < this.memoryCache.expiresAt) {
      return this.memoryCache.result;
    }
    const key = await this.getKey();
    if (!key) {
      const result: ValidationResult = {
        valid: false,
        reason_code: 'not_found',
        entitlements: {},
      };
      // Don't cache "no key" — the user might paste one in the next moment.
      return result;
    }

    let resp: Response;
    try {
      resp = await fetch(`${this.apiBase()}/api/pro/license/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ key }),
      });
    } catch (err) {
      throw new OfflineError(err);
    }

    if (resp.status === 429) {
      // Rate-limited server-side. Tell the caller it's a transient
      // condition by reusing the offline error shape — the user-facing
      // message is the same ("try again").
      throw new OfflineError('Validation rate limit reached. Wait a minute and try again.');
    }

    if (!resp.ok) {
      throw new Error(`License validation failed (${resp.status}). Try again.`);
    }

    const data = (await resp.json()) as ValidationResult;
    // Default entitlements to {} so the caller can `.vscode_ext` safely.
    if (!data.entitlements || typeof data.entitlements !== 'object') {
      data.entitlements = {};
    }
    this.memoryCache = { result: data, expiresAt: Date.now() + CACHE_TTL_MS };
    return data;
  }

  /**
   * Validates and throws if the result doesn't authorise vscode_ext use.
   * Returns the result on success so callers can read `plan` / `trial_ends_at`.
   */
  async requireValid(): Promise<ValidationResult> {
    const result = await this.validate();
    if (!result.valid) {
      throw new EntitlementError(this.reasonToMessage(result), result);
    }
    if (!result.entitlements?.vscode_ext) {
      throw new EntitlementError(
        'Your Velxio plan does not include the VS Code extension. Upgrade to Pro to continue.',
        result,
      );
    }
    return result;
  }

  reasonToMessage(result: ValidationResult): string {
    switch (result.reason_code) {
      case 'not_found':
        return 'License key not recognised. Sign in or paste a valid key.';
      case 'revoked':
        return 'This license key has been revoked. Contact support if this is unexpected.';
      case 'suspended':
        return 'This license key is currently suspended. Contact support to reactivate.';
      case 'trial_expired':
        return 'Your 30-day trial has ended. Upgrade to Pro to continue using the extension.';
      case 'expired':
        return 'Your Velxio subscription has lapsed. Renew to continue.';
      case 'malformed':
        return 'License key format is invalid.';
      default:
        return 'Your Velxio subscription is not active.';
    }
  }
}
