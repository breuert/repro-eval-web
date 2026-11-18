import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runExperiment } from '../src/core/experiment.ts';
import { breakTies, ktu, ktuTopic, prepareRun, rboTopic } from '../src/core/repro-measures.ts';
import { parseQrels, parseRun } from '../src/core/trec-format.ts';
import type { Run } from '../src/core/trec-format.ts';
import { fixtureText } from './helpers.ts';

const run = (name: string) => parseRun(fixtureText(`repro/${name}.txt`)).run;
const qrels = parseQrels(fixtureText('repro/qrels_rpd.txt')).qrels;

function makeRun(topics: Record<string, string[]>): Run {
  return new Map(Object.entries(topics).map(([topic, docs]) => [topic, docs.map((docId, i) => ({ docId, score: docs.length - i }))]));
}

describe('runExperiment', () => {
  test('evaluates several reproductions against the same original', () => {
    const result = runExperiment({
      mode: 'rpd',
      qrels,
      original: { baseline: run('orig_b'), advanced: run('orig_a') },
      reproductions: [
        { name: 'first', runs: { baseline: run('rpd_b'), advanced: run('rpd_a') } },
        { name: 'baseline only', runs: { baseline: run('rpd_b') } },
      ],
    });
    const [first, second] = result.reproductions;
    assert.ok(first && second);
    assert.ok(first.er && first.ktu?.advanced);
    assert.equal(second.er, undefined, 'ER needs an advanced run');
    assert.equal(second.ktu?.advanced, undefined);
    assert.equal(second.ttest.advanced, undefined);
    assert.deepEqual(second.ktu?.baseline.perTopic, first.ktu?.baseline.perTopic);
    assert.ok(first.notes.some((n) => /no results for 1 of 20/.test(n.message)), 'topic 320 is not reproduced');
  });

  test('rejects invalid settings and missing replication qrels', () => {
    const base = { qrels, original: { baseline: run('orig_b') }, reproductions: [] };
    assert.throws(() => runExperiment({ ...base, mode: 'rpd', settings: { rboP: 1 } }), /persistence/);
    assert.throws(() => runExperiment({ ...base, mode: 'rpd', settings: { runLength: 0 } }), /run length/);
    assert.throws(() => runExperiment({ ...base, mode: 'rpl' }), /replication/);
  });
});

describe('document order measures', () => {
  test('breakTies reorders equal scores by descending doc id without sorting by score', () => {
    const ranked = breakTies([
      { docId: 'a', score: 2 },
      { docId: 'c', score: 2 },
      { docId: 'b', score: 2 },
      { docId: 'z', score: 1 },
      { docId: 'y', score: 3 },
    ]);
    assert.deepEqual(ranked.map((d) => d.docId), ['c', 'b', 'a', 'z', 'y']);
  });

  test('prepareRun trims after breaking ties', () => {
    const prepared = prepareRun(new Map([['1', [{ docId: 'a', score: 1 }, { docId: 'b', score: 1 }, { docId: 'c', score: 0 }]]]), 1);
    assert.deepEqual(prepared.get('1'), [{ docId: 'b', score: 1 }]);
  });

  test('KTU is 1 for identical rankings and compares the common top of rankings of different length', () => {
    assert.equal(ktuTopic([{ docId: 'a', score: 1 }, { docId: 'b', score: 0 }], [{ docId: 'a', score: 1 }, { docId: 'b', score: 0 }]), 1);
    const orig = makeRun({ t: ['a', 'b', 'c', 'd'] });
    const rep = makeRun({ t: ['a', 'b', 'c'] });
    const result = ktu(orig, rep);
    assert.equal(result.perTopic.get('t'), 1);
    assert.ok(result.notes.some((n) => /different length/.test(n)));
  });

  test('KTU skips topics that only one run contains', () => {
    const result = ktu(makeRun({ a: ['x', 'y'], b: ['x', 'y'] }), makeRun({ a: ['y', 'x'], c: ['x', 'y'] }));
    assert.deepEqual([...result.perTopic.keys()], ['a']);
    assert.equal(result.perTopic.get('a'), -1);
    assert.equal(result.notes.length, 2);
  });

  test('RBO of identical rankings is 1, of disjoint rankings 0', () => {
    assert.equal(rboTopic(['a', 'b', 'c'], ['a', 'b', 'c'], 0.9, 3), 1);
    assert.equal(rboTopic(['a', 'b'], ['c', 'd'], 0.9, 10), 0);
  });
});
