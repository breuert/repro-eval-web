import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runExperiment } from '../src/core/experiment.ts';
import type { ExperimentResult } from '../src/core/experiment.ts';
import { formatFixed } from '../src/core/format.ts';
import { DISPLAY_ORDER, MEASURES } from '../src/core/measures.ts';
import { cliReport, scoresCsv, summaryCsv, toCsv, toJson } from '../src/core/report.ts';
import { parseQrels, parseRun } from '../src/core/trec-format.ts';
import { fixtureJson, fixtureText, pytrecEvalRounding } from './helpers.ts';

const fixture = fixtureJson<{ versions: { machine?: string }; cli: { rpd: string; rpl: string }; results: { measure_order: string[] } }>('repro.json');
const run = (name: string) => parseRun(fixtureText(`repro/${name}.txt`)).run;
const qrels = (name: string) => parseQrels(fixtureText(`repro/${name}.txt`)).qrels;
const settings = { iprecRounding: pytrecEvalRounding(fixture.versions) };

function experiment(mode: 'rpd' | 'rpl'): ExperimentResult {
  return runExperiment({
    mode,
    qrels: qrels('qrels_rpd'),
    replicationQrels: qrels('qrels_rpl'),
    original: { baseline: run('orig_b'), advanced: run('orig_a') },
    reproductions: [{ name: 'r', runs: mode === 'rpd' ? { baseline: run('rpd_b'), advanced: run('rpd_a') } : { baseline: run('rpl_b'), advanced: run('rpl_a') } }],
    settings,
  });
}

/** repro_eval's CLI omits "ADV" when the advanced value is exactly 0 (`if adv_value:`); the report does not. */
function sameLine(ours: string, cli: string): boolean {
  if (ours === cli) return true;
  return /^ {3,4}ADV {5}-?0\.0000$/.test(ours.slice(cli.length)) && ours.startsWith(cli);
}

describe('formatFixed', () => {
  test('rounds exact ties to even like printf / Python', () => {
    assert.equal(formatFixed(1 / 32), '0.0312');
    assert.equal((1 / 32).toFixed(4), '0.0313');
    assert.equal(formatFixed(3 / 32), '0.0938');
    assert.equal(formatFixed(0.00005), '0.0001');
    assert.equal(formatFixed(0.99995), '1.0000'); // the nearest double lies above the tie
    assert.equal(formatFixed(0.5, 0), '0');
    assert.equal(formatFixed(1.5, 0), '2');
    assert.equal(formatFixed(0.999951), '1.0000');
    assert.equal(formatFixed(-0.25), '-0.2500');
    assert.equal(formatFixed(-0.00001), '-0.0000');
    assert.equal(formatFixed(12.5, 0), '12');
    assert.equal(formatFixed(NaN), 'nan');
    assert.equal(formatFixed(-Infinity), '-inf');
  });
});

describe('cliReport', () => {
  test('lists measures in the order repro_eval reports them', () => {
    assert.deepEqual(DISPLAY_ORDER.map((i) => MEASURES[i]?.id), fixture.results.measure_order);
  });

  for (const mode of ['rpd', 'rpl'] as const) {
    test(`reproduces the output of python -m repro_eval -t ${mode}`, () => {
      const result = experiment(mode);
      const ours = cliReport(result, result.reproductions[0] as ExperimentResult['reproductions'][number]).split('\n');
      const cli = fixture.cli[mode].replace(/\n$/, '').split('\n');
      assert.equal(ours.length, cli.length, 'number of lines');
      const differing = ours.map((line, i) => [line, cli[i] as string] as const).filter(([a, b]) => !sameLine(a, b));
      assert.deepEqual(differing, []);
    });
  }
});

describe('exports', () => {
  const result = experiment('rpd');

  test('JSON mirrors repro_eval dicts and encodes non-finite numbers as strings', () => {
    const json = toJson(result, { perTopic: true }) as Record<string, unknown>;
    const text = JSON.stringify(json);
    const parsed = JSON.parse(text) as { reproductions: Array<{ ktu: { baseline: { mean: number } }; er: Record<string, unknown> }> };
    assert.equal(parsed.reproductions[0]?.ktu.baseline.mean, result.reproductions[0]?.ktu?.baseline.mean);
    assert.equal(Object.keys(parsed.reproductions[0]?.er ?? {}).length, MEASURES.length);
    assert.equal(JSON.stringify(toJson({ ...result, reproductions: [] })).includes('NaN'), false);
  });

  test('CSV quoting and shapes', () => {
    assert.equal(toCsv(['a', 'b'], [['x,y', 'he said "hi"'], [1, NaN]]), 'a,b\n"x,y","he said ""hi"""\n1,NaN\n');
    const scores = scoresCsv(result).trim().split('\n');
    assert.equal(scores.length, 1 + 4 * 20 * MEASURES.length);
    const summary = summaryCsv(result).trim().split('\n');
    assert.equal(summary.length, 1 + MEASURES.length);
    assert.equal(summary[0]?.split(',').length, 14);
  });
});
