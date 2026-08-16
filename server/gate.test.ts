import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, createGate, readGateConfig, type GateConfig } from './gate.ts';

const base: GateConfig = {
  mode: 'enforce',
  secret: 'sekrit',
  perMinutePerIp: 3,
  dailyCap: 5,
};

/* Controllable clock: every rate-limit and daily-rollover assertion needs to
 * move time deliberately rather than sleep for it. */
function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('enforce: a valid secret under the limits is allowed', () => {
  const gate = createGate(base, clock().now);
  assert.equal(gate.check('1.1.1.1', 'sekrit').allow, true);
});

test('enforce: missing and wrong secrets are both 401, with the same user-facing text', () => {
  const gate = createGate(base, clock().now);
  const missing = gate.check('1.1.1.1', undefined);
  const wrong = gate.check('1.1.1.1', 'nope');

  assert.equal(missing.allow, false);
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  // The reason distinguishes them for us; the message must not distinguish them
  // for an attacker probing which half of the check they failed.
  assert.equal(missing.message, wrong.message);
  assert.notEqual(missing.reason, wrong.reason);
});

test('enforce: an unconfigured server fails CLOSED, not open', () => {
  const gate = createGate({ ...base, secret: undefined }, clock().now);
  const d = gate.check('1.1.1.1', 'anything');
  assert.equal(d.allow, false);
  assert.equal(d.status, 503);
  assert.equal(d.code, 'not_configured');
});

test('enforce: the per-IP burst limit rejects past the ceiling and recovers after a minute', () => {
  const c = clock();
  const gate = createGate(base, c.now);

  for (let i = 0; i < 3; i++) {
    assert.equal(gate.check('1.1.1.1', 'sekrit').allow, true, `request ${i + 1} should pass`);
  }
  const blocked = gate.check('1.1.1.1', 'sekrit');
  assert.equal(blocked.allow, false);
  assert.equal(blocked.status, 429);

  c.advance(60_001);
  assert.equal(gate.check('1.1.1.1', 'sekrit').allow, true, 'window should have slid');
});

test('enforce: the burst limit is per IP, not global', () => {
  const gate = createGate(base, clock().now);
  for (let i = 0; i < 3; i++) gate.check('1.1.1.1', 'sekrit');
  assert.equal(gate.check('2.2.2.2', 'sekrit').allow, true);
});

test('enforce: the daily cap is checked BEFORE the secret, so a valid key cannot bust the bill', () => {
  const c = clock();
  const gate = createGate({ ...base, perMinutePerIp: 100 }, c.now);

  for (let i = 0; i < 5; i++) {
    assert.equal(gate.check('1.1.1.1', 'sekrit').allow, true, `request ${i + 1} within cap`);
  }
  const capped = gate.check('1.1.1.1', 'sekrit');
  assert.equal(capped.allow, false);
  assert.equal(capped.status, 503);
  assert.equal(capped.code, 'daily_cap');
  assert.equal(gate.stats().remaining, 0);
});

test('the daily cap resets at the UTC day boundary', () => {
  const c = clock(Date.UTC(2026, 7, 16, 23, 59, 0));
  const gate = createGate({ ...base, perMinutePerIp: 100 }, c.now);

  for (let i = 0; i < 5; i++) gate.check('1.1.1.1', 'sekrit');
  assert.equal(gate.check('1.1.1.1', 'sekrit').allow, false);

  c.advance(2 * 60_000); // past midnight UTC
  const after = gate.check('1.1.1.1', 'sekrit');
  assert.equal(after.allow, true);
  assert.equal(gate.stats().allowed, 1);
});

test('log mode allows what enforce would reject, and counts it', () => {
  const gate = createGate({ ...base, mode: 'log' }, clock().now);

  const d = gate.check('1.1.1.1', 'wrong-key');
  assert.equal(d.allow, true, 'log mode must not block');
  assert.match(d.reason, /x-plantai-key/, 'but it must record why it would have');

  const s = gate.stats();
  assert.equal(s.wouldReject, 1);
  assert.equal(s.rejected, 0);
});

test('log mode still allows requests when no secret is configured at all', () => {
  // This is the state of a fresh deploy before `fly secrets set`. It must not
  // brick the API before the operator has flipped anything.
  const gate = createGate({ ...base, mode: 'log', secret: undefined }, clock().now);
  assert.equal(gate.check('1.1.1.1', undefined).allow, true);
});

test('checkSecret does not consume the daily cap or the burst limit', () => {
  // Polling an eight-minute job runs to ~160 requests. If polls counted, the
  // client would be rate-limited out of collecting the result it paid for.
  const gate = createGate(base, clock().now);

  for (let i = 0; i < 50; i++) {
    assert.equal(gate.checkSecret('1.1.1.1', 'sekrit').allow, true, `poll ${i + 1}`);
  }
  assert.equal(gate.stats().allowed, 0, 'polls are not billable requests');
  assert.equal(gate.stats().remaining, base.dailyCap);
});

test('checkSecret still rejects a wrong secret in enforce mode', () => {
  const gate = createGate(base, clock().now);
  const d = gate.checkSecret('1.1.1.1', 'nope');
  assert.equal(d.allow, false);
  assert.equal(d.status, 401);
});

test('readGateConfig defaults to log mode — enforcing is always an explicit act', () => {
  assert.equal(readGateConfig(() => undefined).mode, 'log');
  assert.equal(readGateConfig((k) => (k === 'GATE_MODE' ? 'enforce' : undefined)).mode, 'enforce');
  // Anything that is not exactly "enforce" is log. A typo must fail safe.
  assert.equal(readGateConfig((k) => (k === 'GATE_MODE' ? 'ENFORCE' : undefined)).mode, 'log');
});

test('readGateConfig falls back to sane limits when the env is empty', () => {
  const c = readGateConfig(() => undefined);
  assert.ok(c.dailyCap > 0, 'an unset cap must not mean an unlimited cap');
  assert.ok(c.perMinutePerIp > 0);
});

test('clientIp prefers the first x-forwarded-for hop over the socket address', () => {
  // Behind Fly the socket address is the proxy, which would put every user in
  // the world into a single rate-limit bucket.
  assert.equal(clientIp({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, '10.0.0.1'), '9.9.9.9');
  assert.equal(clientIp({ 'x-forwarded-for': ['8.8.8.8'] }, '10.0.0.1'), '8.8.8.8');
  assert.equal(clientIp({}, '10.0.0.1'), '10.0.0.1');
  assert.equal(clientIp({ 'x-forwarded-for': '' }, '10.0.0.1'), '10.0.0.1');
});
