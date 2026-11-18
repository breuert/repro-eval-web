import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IprecRounding } from '../src/core/trec-eval.ts';

/**
 * The iprec_at_recall variant of the pytrec_eval build that generated a fixture:
 * ARM builds fuse a multiply-add that x86-64 builds round twice.
 */
export function pytrecEvalRounding(versions: { machine?: string }): IprecRounding {
  return /^(arm64|aarch64)/i.test(versions.machine ?? '') ? 'v9-fma' : 'v9';
}

const FIXTURES = new URL('./fixtures/', import.meta.url);

export function fixtureText(path: string): string {
  return readFileSync(new URL(path, FIXTURES), 'utf8');
}

/** Fixture JSON with the non-finite numbers that `scripts/make_fixtures.py` encodes as strings. */
export function fixtureJson<T = unknown>(path: string): T {
  return JSON.parse(fixtureText(path), (_key, value: unknown) => {
    if (value === 'NaN') return NaN;
    if (value === 'Infinity') return Infinity;
    if (value === '-Infinity') return -Infinity;
    return value;
  }) as T;
}

/** |actual − expected| ≤ abs + rel·|expected|, with NaN equal to NaN and infinities equal to themselves. */
export function isClose(actual: number, expected: number, abs = 1e-12, rel = 1e-12): boolean {
  if (Number.isNaN(expected)) return Number.isNaN(actual);
  if (!Number.isFinite(expected)) return actual === expected;
  return Math.abs(actual - expected) <= abs + rel * Math.abs(expected);
}

export function assertClose(actual: number, expected: number, message: string, abs = 1e-12, rel = 1e-12): void {
  if (!isClose(actual, expected, abs, rel)) {
    assert.fail(`${message}: expected ${expected}, got ${actual} (difference ${actual - expected})`);
  }
}

/** Compare two records of numbers; collects every mismatch into one failure message. */
export function assertRecordClose(
  actual: Record<string, number>,
  expected: Record<string, number>,
  label: string,
  abs = 1e-12,
  rel = 1e-12,
): void {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${label}: keys differ`);
  const errors: string[] = [];
  for (const [key, value] of Object.entries(expected)) {
    const got = actual[key] as number;
    if (!isClose(got, value, abs, rel)) errors.push(`${key}: expected ${value}, got ${got}`);
  }
  if (errors.length > 0) assert.fail(`${label}: ${errors.length} mismatch(es)\n  ${errors.slice(0, 15).join('\n  ')}`);
}
