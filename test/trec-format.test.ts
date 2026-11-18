import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compareCodePoints } from '../src/core/compare.ts';
import { TrecFormatError, formatQrels, formatRun, parseQrels, parseRun, parseScore } from '../src/core/trec-format.ts';

describe('parseRun', () => {
  test('keeps file order of documents and sorts topics by code point', () => {
    const { run, info } = parseRun(['2 Q0 b 1 3.0 tag', '10 Q0 x 1 1 tag', '2 Q0 a 2 5 tag'].join('\n'));
    assert.deepEqual([...run.keys()], ['10', '2']);
    assert.deepEqual(run.get('2')?.map((d) => d.docId), ['b', 'a']);
    assert.equal(info.numTopics, 2);
    assert.equal(info.numDocs, 3);
    assert.equal(info.unsortedTopics, 1);
    assert.deepEqual(info.tags, ['tag']);
  });

  test('a repeated document keeps its first position and its last score (Python dict semantics)', () => {
    const { run, info } = parseRun(['1 Q0 a 1 3 t', '1 Q0 b 2 2 t', '1 Q0 a 3 9 t'].join('\n'));
    assert.deepEqual(run.get('1'), [
      { docId: 'a', score: 9 },
      { docId: 'b', score: 2 },
    ]);
    assert.equal(info.duplicates, 1);
  });

  test('skips blank lines and # comments, handles CRLF and tabs', () => {
    const { run, info } = parseRun('# ir_metadata.start\r\n\r\n1\tQ0\td1\t1\t0.5\trun\r\n  # trailing comment\n');
    assert.equal(run.get('1')?.[0]?.docId, 'd1');
    assert.deepEqual(info.comments, [' ir_metadata.start', ' trailing comment']);
  });

  test('parses scores like Python float()', () => {
    assert.equal(parseScore('1e3'), 1000);
    assert.equal(parseScore('-.5'), -0.5);
    assert.equal(parseScore('2.'), 2);
    assert.equal(parseScore('-inf'), -Infinity);
    assert.equal(parseScore('Infinity'), Infinity);
    assert.ok(Number.isNaN(parseScore('abc')));
    assert.ok(Number.isNaN(parseScore('0x10')));
  });

  test('reports malformed lines with their line number', () => {
    assert.throws(() => parseRun('1 Q0 d1 1 0.5 tag\n1 0 d2 1'), (e: unknown) => {
      assert.ok(e instanceof TrecFormatError);
      assert.equal(e.line, 2);
      assert.match(e.message, /qrels file/);
      return true;
    });
    assert.throws(() => parseRun('1 Q0 d1 1 high tag'), /not a number/);
    assert.throws(() => parseRun('1 Q0 d1 1 nan tag'), /not a number/);
    assert.throws(() => parseRun('\n# only a comment\n'), /no run lines/);
  });

  test('round-trips through formatRun', () => {
    const text = '7 Q0 a 1 2 t\n7 Q0 b 2 1 t\n';
    assert.equal(formatRun(parseRun(text).run, 't'), text);
  });
});

describe('parseQrels', () => {
  test('reads labels, counts relevant judgements and duplicates', () => {
    const { qrels, info } = parseQrels(['2 0 a 1', '1 0 b 0', '2 0 c 2', '2 0 a 0', '1 0 d -1'].join('\n'));
    assert.deepEqual([...qrels.keys()], ['1', '2']);
    assert.equal(qrels.get('2')?.get('a'), 0);
    assert.equal(info.numJudged, 4);
    assert.equal(info.numRelevant, 1);
    assert.equal(info.duplicates, 1);
    assert.deepEqual([...info.labels], [
      [-1, 1],
      [0, 2],
      [2, 1],
    ]);
  });

  test('accepts integer-valued decimals, rejects fractional labels and wrong column counts', () => {
    assert.equal(parseQrels('1 0 a 2.0').qrels.get('1')?.get('a'), 2);
    assert.throws(() => parseQrels('1 0 a 0.5'), /not an integer/);
    assert.throws(() => parseQrels('1 Q0 a 1 1.5 run'), /run file/);
  });

  test('round-trips through formatQrels', () => {
    const text = '1 0 a 1\n1 0 b 0\n';
    assert.equal(formatQrels(parseQrels(text).qrels), text);
  });
});

describe('compareCodePoints', () => {
  test('orders like Python str / C strcmp on UTF-8, unlike UTF-16 comparison', () => {
    const emoji = '\u{1F600}';
    const fullwidthA = 'Ａ';
    assert.ok(emoji < fullwidthA, 'UTF-16 order puts the surrogate pair first');
    assert.equal(compareCodePoints(emoji, fullwidthA), 1);
    assert.equal(compareCodePoints('a', 'ab'), -1);
    assert.equal(compareCodePoints('b', 'a'), 1);
    assert.equal(compareCodePoints('x', 'x'), 0);
    const sorted = ['b', emoji, 'é', fullwidthA, 'B', '10', '9'].sort(compareCodePoints);
    assert.deepEqual(sorted, ['10', '9', 'B', 'b', 'é', fullwidthA, emoji]);
  });
});
