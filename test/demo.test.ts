import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runExperiment } from '../src/core/experiment.ts';
import { measureIndex } from '../src/core/measures.ts';
import { parseQrels, parseRun } from '../src/core/trec-format.ts';
import { generateDemo } from '../src/ui/demo.ts';

describe('synthetic example data', () => {
  const data = generateDemo();

  test('is deterministic', () => {
    assert.equal(generateDemo().original.baseline, data.original.baseline);
  });

  test('parses and behaves as described in the dashboard', () => {
    const run = (text: string) => parseRun(text).run;
    const result = runExperiment({
      mode: 'rpd',
      qrels: parseQrels(data.qrels).qrels,
      original: { baseline: run(data.original.baseline), advanced: run(data.original.advanced) },
      reproductions: data.reproductions.map((r) => ({ name: r.name, runs: { baseline: run(r.baseline), advanced: run(r.advanced) } })),
    });
    const ap = measureIndex('AP');
    const [close, reimplemented, weaker] = result.reproductions;
    assert.ok(close && reimplemented && weaker);
    // the advanced original is better than the baseline
    assert.ok((result.original.arp.advanced?.[ap] ?? 0) > (result.original.arp.baseline[ap] ?? 0) + 0.1);
    // the close reproduction reproduces the effect and the rankings best
    assert.ok(Math.abs((close.er?.[ap] ?? 0) - 1) < 0.1);
    assert.ok((close.rbo?.baseline.mean ?? 0) > 0.8);
    assert.ok((reimplemented.rbo?.baseline.mean ?? 1) < 0.5);
    assert.ok((weaker.er?.[ap] ?? 1) < 0.5);
  });

  test('replications use the other collection', () => {
    const run = (text: string) => parseRun(text).run;
    const result = runExperiment({
      mode: 'rpl',
      qrels: parseQrels(data.qrels).qrels,
      replicationQrels: parseQrels(data.replicationQrels).qrels,
      original: { baseline: run(data.original.baseline), advanced: run(data.original.advanced) },
      reproductions: data.replications.map((r) => ({ name: r.name, runs: { baseline: run(r.baseline), advanced: run(r.advanced) } })),
    });
    assert.equal(result.reproductions.length, 2);
    assert.ok(result.reproductions.every((r) => r.er !== undefined && r.ktu === undefined));
    assert.deepEqual(result.reproductions[0]?.scores.baseline.missingTopics, []);
  });
});
