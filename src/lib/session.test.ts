import { describe, expect, it } from 'vitest';
import { makeQuestion } from '../test-helpers.ts';
import { EMPTY_PROGRESS, recordAnswer, toggleMark } from './progress.ts';
import { type Rng, shuffle } from './random.ts';
import {
  createSession,
  gradeExam,
  selectExamAnswer,
  submitPracticeAnswer,
  summarize,
} from './session.ts';

const pool = Array.from({ length: 12 }, (_, i) => makeQuestion(`q${i + 1}`));
const single = makeQuestion('s1', { domain: 'store', answer: ['b'] });
const multi = makeQuestion('m1', {
  domain: 'ingest',
  type: 'multiple',
  keys: ['a', 'b', 'c', 'd', 'e'],
  answer: ['a', 'c'],
});
const map = new Map([single, multi].map((q) => [q.id, q]));

/** 種が同じなら同じ列を返す乱数（mulberry32）。出題の結果を再現できるよう、Math.random の代わりに使う。 */
const seeded = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe('shuffle', () => {
  it('3つの要素の6通りの並べ方だけが、どれもほぼ同じ回数ずつ出る', () => {
    const rng = seeded(1);
    const runs = 60000;
    const counts = new Map<string, number>();
    for (let i = 0; i < runs; i++) {
      const order = shuffle(['a', 'b', 'c'], rng).join('');
      counts.set(order, (counts.get(order) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(['abc', 'acb', 'bac', 'bca', 'cab', 'cba']);
    // 1通りあたりの期待値は10000回、標準偏差は約91回。偏りのない並べ替えならまず外れず、偏りのある並べ替えは外れる幅にする
    for (const [order, n] of counts) {
      expect(n, order).toBeGreaterThan(9500);
      expect(n, order).toBeLessThan(10500);
    }
  });

  it('元の配列を変更しない', () => {
    const input = [1, 2, 3];
    shuffle(input, () => 0);
    expect(input).toEqual([1, 2, 3]);
  });
});

describe('createSession', () => {
  it('対象の問題から指定した数を、重複なくランダムに選ぶ', () => {
    const s = createSession('practice', pool, 5, 0, seeded(1));
    expect(s.questionIds).toHaveLength(5);
    expect(new Set(s.questionIds).size).toBe(5);
    for (const id of s.questionIds) expect(pool.map((q) => q.id)).toContain(id);
  });

  it('指定した数より対象が少なければ、対象の全問を出題する', () => {
    expect(createSession('practice', pool, 50, 0).questionIds).toHaveLength(12);
    expect(createSession('practice', pool, 'all', 0).questionIds).toHaveLength(12);
  });

  it('同じ条件でも、乱数によって出題順が変わる', () => {
    const a = createSession('practice', pool, 'all', 0, seeded(1));
    const b = createSession('practice', pool, 'all', 0, seeded(2));
    expect(a.questionIds).not.toEqual(b.questionIds);
    expect([...a.questionIds].sort()).toEqual([...b.questionIds].sort());
  });

  it('問題ごとに、選択肢の表示順を全選択肢の並べ替えとして決める', () => {
    const s = createSession('practice', [multi], 'all', 0, seeded(1));
    expect([...(s.choiceOrder.m1 ?? [])].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('模擬試験だけに、開始から120分後の制限時刻を設定する', () => {
    expect(createSession('exam', pool, 5, 1000).deadline).toBe(1000 + 120 * 60 * 1000);
    expect(createSession('practice', pool, 5, 1000).deadline).toBeUndefined();
  });
});

describe('submitPracticeAnswer', () => {
  const session = createSession('practice', [single, multi], 'all', 0);

  it('正解を記録し、累計の正解回数を増やす', () => {
    const r = submitPracticeAnswer(session, EMPTY_PROGRESS, single, ['b'], 10);
    expect(r.session.results.s1).toBe(true);
    expect(r.progress.stats.s1).toMatchObject({ correct: 1, wrong: 0, lastResult: 'correct' });
  });

  it('不正解を記録し、累計の間違えた回数を増やす', () => {
    const r = submitPracticeAnswer(session, EMPTY_PROGRESS, single, ['a'], 10);
    expect(r.session.results.s1).toBe(false);
    expect(r.progress.stats.s1).toMatchObject({ correct: 0, wrong: 1 });
  });

  it('複数選択は、正解の選択肢をすべて選んだときだけ正解にする', () => {
    const ok = submitPracticeAnswer(session, EMPTY_PROGRESS, multi, ['c', 'a'], 10);
    expect(ok.session.results.m1).toBe(true);
    const partial = submitPracticeAnswer(session, EMPTY_PROGRESS, multi, ['a', 'b'], 10);
    expect(partial.session.results.m1).toBe(false);
  });

  it('同じ回で同じ問題に2回回答しても、成績は1回分だけ記録する', () => {
    const first = submitPracticeAnswer(session, EMPTY_PROGRESS, single, ['a'], 10);
    const second = submitPracticeAnswer(first.session, first.progress, single, ['b'], 20);
    expect(second.progress.stats.s1).toMatchObject({ correct: 0, wrong: 1 });
    expect(second.session.results.s1).toBe(false);
  });
});

describe('gradeExam', () => {
  it('未回答は不正解として採点するが、間違えた回数には数えない', () => {
    let s = createSession('exam', [single, multi], 'all', 0);
    s = selectExamAnswer(s, 's1', ['b']);
    const r = gradeExam(s, EMPTY_PROGRESS, map, 500);
    expect(r.session.results).toEqual({ s1: true, m1: false });
    expect(r.session.finishedAt).toBe(500);
    expect(r.progress.stats.s1).toMatchObject({ correct: 1, wrong: 0 });
    expect(r.progress.stats.m1).toBeUndefined();
  });

  it('回答した問題の不正解は、間違えた回数に数える', () => {
    let s = createSession('exam', [single], 'all', 0);
    s = selectExamAnswer(s, 's1', ['c']);
    expect(gradeExam(s, EMPTY_PROGRESS, map, 500).progress.stats.s1).toMatchObject({ wrong: 1 });
  });
});

describe('summarize', () => {
  it('採点済みの問題について、全体と分野別の正答数を数える', () => {
    let s = createSession('exam', [single, multi], 'all', 0);
    s = selectExamAnswer(s, 's1', ['b']);
    s = selectExamAnswer(s, 'm1', ['a', 'b']);
    const { session } = gradeExam(s, EMPTY_PROGRESS, map, 500);
    const sum = summarize(session, map);
    expect(sum).toMatchObject({ total: 2, correct: 1 });
    expect(sum.byDomain.store).toEqual({ total: 1, correct: 1 });
    expect(sum.byDomain.ingest).toEqual({ total: 1, correct: 0 });
    expect(sum.byDomain.design).toEqual({ total: 0, correct: 0 });
  });
});

describe('progress', () => {
  it('間違えた回数は、あとで正解しても減らない', () => {
    let p = recordAnswer(EMPTY_PROGRESS, 'q1', false, 1);
    p = recordAnswer(p, 'q1', false, 2);
    p = recordAnswer(p, 'q1', true, 3);
    expect(p.stats.q1).toEqual({ correct: 1, wrong: 2, lastResult: 'correct', lastAnsweredAt: 3 });
  });

  it('見直しの印は、付け外しを切り替える', () => {
    const on = toggleMark(EMPTY_PROGRESS, 'q1');
    expect(on.marked).toEqual(['q1']);
    expect(toggleMark(on, 'q1').marked).toEqual([]);
  });
});
