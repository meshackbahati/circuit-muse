/**
 * Vitest for GraceBanner.bannerFor — pure function that picks the
 * right banner tone based on license status + current time.
 *
 * Run from velxio/frontend:
 *   npx vitest run src/desktop/__tests__/GraceBanner.test.ts
 *
 * Or via the umbrella script:
 *   E:\Hardware\velxio-prod\pro\desktop\testeo\run-tests.bat
 *
 * These tests are pure logic (no DOM, no React) so they finish in
 * milliseconds. Render-level assertions for the actual component
 * are covered by manual smoke-tests after a real install.
 */

import { describe, it, expect } from 'vitest';
import { bannerFor } from '../GraceBanner';

type Claims = {
  sub: string;
  plan: string;
  ent: Record<string, boolean>;
  iat: number;
  exp: number;
  trial_ends_at?: number | null;
  subscription_period_end?: number | null;
  hard_grace_hours?: number;
};

function claimsTrial(overrides: Partial<Claims> = {}): Claims {
  return {
    sub: 'vlx_trial_test',
    plan: 'trial',
    ent: { desktop: true },
    iat: 0,
    exp: 0,
    trial_ends_at: null,
    subscription_period_end: null,
    hard_grace_hours: 24,
    ...overrides,
  };
}

const DAY = 86400 * 1000;
const HOUR = 3600 * 1000;

describe('bannerFor — active state pre-expiry', () => {
  const nowMs = Date.now();

  it('returns null when trial expires in >5 days', () => {
    const claims = claimsTrial({
      exp: Math.floor((nowMs + 30 * DAY) / 1000),
      trial_ends_at: Math.floor((nowMs + 10 * DAY) / 1000),
    });
    const banner = bannerFor({ state: 'active', claims }, nowMs);
    expect(banner).toBeNull();
  });

  it('returns amber when trial expires in 5 days', () => {
    const claims = claimsTrial({
      exp: Math.floor((nowMs + 30 * DAY) / 1000),
      trial_ends_at: Math.floor((nowMs + 4 * DAY) / 1000),
    });
    const banner = bannerFor({ state: 'active', claims }, nowMs);
    expect(banner).not.toBeNull();
    expect(banner!.tone).toBe('amber');
    expect(banner!.dismissible).toBe(true);
    expect(banner!.message).toMatch(/free trial/);
    expect(banner!.message).toMatch(/4 day/);
  });

  it('returns red when trial expires in 23 hours', () => {
    const claims = claimsTrial({
      exp: Math.floor((nowMs + 30 * DAY) / 1000),
      trial_ends_at: Math.floor((nowMs + 23 * HOUR) / 1000),
    });
    const banner = bannerFor({ state: 'active', claims }, nowMs);
    expect(banner).not.toBeNull();
    expect(banner!.tone).toBe('red');
    expect(banner!.dismissible).toBe(false);
    expect(banner!.message).toMatch(/23h/);
  });

  it('falls back to claims.exp when trial_ends_at is missing', () => {
    // Pre-v0.3.0 JWTs didn't carry trial_ends_at separately. Make
    // sure we still produce a banner so cached old JWTs don't go
    // silent during the upgrade window.
    const claims = claimsTrial({
      exp: Math.floor((nowMs + 3 * DAY) / 1000),
      trial_ends_at: null,
    });
    const banner = bannerFor({ state: 'active', claims }, nowMs);
    expect(banner).not.toBeNull();
    expect(banner!.tone).toBe('amber');
  });

  it('uses subscription_period_end for paid plans', () => {
    const claims = claimsTrial({
      plan: 'pro',
      exp: Math.floor((nowMs + 30 * DAY) / 1000),
      trial_ends_at: null,
      subscription_period_end: Math.floor((nowMs + 3 * DAY) / 1000),
    });
    const banner = bannerFor({ state: 'active', claims }, nowMs);
    expect(banner).not.toBeNull();
    expect(banner!.tone).toBe('amber');
    expect(banner!.message).toMatch(/Velxio Pro subscription/);
    expect(banner!.message).not.toMatch(/free trial/);
  });

  it('returns null when secondsUntilExp <= 0 (state should be soft_grace already)', () => {
    const claims = claimsTrial({
      exp: Math.floor((nowMs - 60 * 1000) / 1000),
      trial_ends_at: Math.floor((nowMs - 60 * 1000) / 1000),
    });
    const banner = bannerFor({ state: 'active', claims }, nowMs);
    expect(banner).toBeNull();
  });
});

describe('bannerFor — post-expiry grace states', () => {
  const nowMs = Date.now();
  const expiredClaims = claimsTrial({
    exp: Math.floor((nowMs - 5 * DAY) / 1000),
    trial_ends_at: Math.floor((nowMs - 5 * DAY) / 1000),
  });

  it('soft_grace returns amber with offline-grace messaging', () => {
    const banner = bannerFor(
      { state: 'soft_grace', claims: expiredClaims, days_remaining: 2 },
      nowMs,
    );
    expect(banner).not.toBeNull();
    expect(banner!.tone).toBe('amber');
    expect(banner!.dismissible).toBe(false);
    expect(banner!.message).toMatch(/offline grace/);
    expect(banner!.message).toMatch(/2 day/);
  });

  it('hard_grace returns red and disables operations', () => {
    const banner = bannerFor(
      { state: 'hard_grace', claims: expiredClaims, hours_remaining: 12 },
      nowMs,
    );
    expect(banner).not.toBeNull();
    expect(banner!.tone).toBe('red');
    expect(banner!.dismissible).toBe(false);
    expect(banner!.message).toMatch(/Compile and Save are temporarily disabled/);
  });

  it('locked returns null (LockoutOverlay covers the UI)', () => {
    const banner = bannerFor(
      { state: 'locked', last_plan: 'trial' },
      nowMs,
    );
    expect(banner).toBeNull();
  });

  it('tampered returns null (LockoutOverlay covers the UI)', () => {
    const banner = bannerFor({ state: 'tampered' }, nowMs);
    expect(banner).toBeNull();
  });
});

describe('bannerFor — quiet states', () => {
  const nowMs = Date.now();

  it('unauthenticated returns null (no key = no banner, LockoutOverlay handles UI)', () => {
    const banner = bannerFor({ state: 'unauthenticated' }, nowMs);
    expect(banner).toBeNull();
  });

  it('active well-future expiry returns null', () => {
    const claims = claimsTrial({
      exp: Math.floor((nowMs + 90 * DAY) / 1000),
      trial_ends_at: Math.floor((nowMs + 60 * DAY) / 1000),
    });
    const banner = bannerFor({ state: 'active', claims }, nowMs);
    expect(banner).toBeNull();
  });
});

describe('bannerFor — dismissibility', () => {
  const nowMs = Date.now();

  it('only the amber pre-expiry banner is dismissible', () => {
    const dismissible = [
      bannerFor(
        {
          state: 'active',
          claims: claimsTrial({
            exp: Math.floor((nowMs + 30 * DAY) / 1000),
            trial_ends_at: Math.floor((nowMs + 4 * DAY) / 1000),
          }),
        },
        nowMs,
      ),
    ];
    const nonDismissible = [
      bannerFor(
        {
          state: 'active',
          claims: claimsTrial({
            exp: Math.floor((nowMs + 30 * DAY) / 1000),
            trial_ends_at: Math.floor((nowMs + 1 * HOUR) / 1000),
          }),
        },
        nowMs,
      ),
      bannerFor(
        {
          state: 'soft_grace',
          claims: claimsTrial(),
          days_remaining: 2,
        },
        nowMs,
      ),
      bannerFor(
        {
          state: 'hard_grace',
          claims: claimsTrial(),
          hours_remaining: 12,
        },
        nowMs,
      ),
    ];

    for (const b of dismissible) {
      expect(b?.dismissible).toBe(true);
    }
    for (const b of nonDismissible) {
      // null banners (locked/tampered) are filtered out by the
      // returned-null short-circuit in GraceBanner itself.
      if (b !== null) {
        expect(b.dismissible).toBe(false);
      }
    }
  });
});
