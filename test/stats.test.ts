import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { kendallTauB, logGamma, mean, roundTo, studentTwoSidedP, ttestInd, ttestRel } from '../src/core/stats.ts';
import { assertClose, fixtureJson } from './helpers.ts';

interface StatsFixture {
  mean: Array<{ x: number[]; mean: number }>;
  ttest_rel: Array<{ a: number[]; b: number[]; statistic: number; pvalue: number }>;
  ttest_ind: Array<{ a: number[]; b: number[]; statistic: number; pvalue: number }>;
  pvalue: Array<{ t: number; df: number; p: number }>;
  lgamma: Array<{ x: number; lgamma: number }>;
  kendalltau: Array<{ x: number[]; y: number[]; tau: number }>;
}

const ref = fixtureJson<StatsFixture>('stats.json');

describe('numerics against NumPy / SciPy', () => {
  test('mean is bit-identical to numpy.mean (pairwise summation)', () => {
    for (const { x, mean: expected } of ref.mean) assert.equal(mean(x), expected, `n=${x.length}`);
  });

  test('ln Γ agrees with math.lgamma', () => {
    for (const { x, lgamma } of ref.lgamma) assertClose(logGamma(x), lgamma, `lgamma(${x})`, 1e-13, 1e-14);
  });

  test('two-sided Student t p-values agree with 2 * scipy.stats.t.sf(|t|, df)', () => {
    for (const { t, df, p } of ref.pvalue) {
      // Near p = 1, SciPy rounds the complement away for df = 1 (it returns 1 for t = 1e-9,
      // the exact value is 1 - 2/π · atan(1e-9)); allow that, but stay strict for small p.
      // For df ~ 1e5 both implementations lose ~1e-11 (relative) in ln B(df/2, 1/2).
      assertClose(studentTwoSidedP(t, df), p, `t=${t}, df=${df}`, p > 0.999 ? 1e-9 : 1e-300, 1e-9);
    }
    assertClose(studentTwoSidedP(1e-9, 1), 1 - (2 / Math.PI) * Math.atan(1e-9), 'Cauchy', 1e-16, 0);
  });

  test('ttest_rel', () => {
    for (const { a, b, statistic, pvalue } of ref.ttest_rel) {
      const r = ttestRel(a, b);
      assertClose(r.statistic, statistic, `statistic n=${a.length}`, 1e-12, 1e-11);
      assertClose(r.pvalue, pvalue, `p-value n=${a.length}`, 1e-300, 1e-10);
    }
  });

  test('ttest_ind', () => {
    for (const { a, b, statistic, pvalue } of ref.ttest_ind) {
      const r = ttestInd(a, b);
      assertClose(r.statistic, statistic, `statistic n=${a.length},${b.length}`, 1e-12, 1e-11);
      assertClose(r.pvalue, pvalue, `p-value n=${a.length},${b.length}`, 1e-300, 1e-10);
    }
  });

  test('Kendall tau-b (with and without ties)', () => {
    for (const { x, y, tau } of ref.kendalltau) assertClose(kendallTauB(x, y), tau, `n=${x.length}`, 1e-15, 0);
  });

  test('edge cases', () => {
    assert.ok(Number.isNaN(mean([])));
    assert.equal(studentTwoSidedP(0, 10), 1);
    assert.equal(studentTwoSidedP(Infinity, 10), 0);
    assert.ok(Number.isNaN(studentTwoSidedP(NaN, 10)));
    assert.ok(Number.isNaN(kendallTauB([1], [2])));
    assert.ok(Number.isNaN(kendallTauB([1, 1, 1], [1, 2, 3])));
    assert.equal(roundTo(0.123456789012345678, 14), 0.12345678901235);
  });
});
