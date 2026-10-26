import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from './filter.ts';
import type { SessionSummary } from './session.ts';
import {
  type AppData,
  addHistory,
  DEFAULT_DATA,
  exportData,
  importData,
  loadData,
  saveData,
} from './storage.ts';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const sample: AppData = {
  progress: {
    stats: {
      'design-security-001': { correct: 2, wrong: 3, lastResult: 'wrong', lastAnsweredAt: 5 },
    },
    marked: ['store-selection-002'],
  },
  session: null,
  history: [{ mode: 'exam', startedAt: 1, finishedAt: 2, total: 50, correct: 36 }],
  prefs: { filter: { ...EMPTY_FILTER, domains: ['store'], minWrong: 2 }, count: 20 },
};

/**
 * 以前の版が保存したデータ（sample と同じ内容）。保存データの形式を変えても、利用者の端末に残っているこの形式を読み込めるようにする。
 * 型から作ると形式の変更に追従してしまうため、保存される JSON のとおりに書く。
 */
const savedByEarlierVersion = {
  progress: {
    stats: {
      'design-security-001': { correct: 2, wrong: 3, lastResult: 'wrong', lastAnsweredAt: 5 },
    },
    marked: ['store-selection-002'],
  },
  session: null,
  history: [{ mode: 'exam', startedAt: 1, finishedAt: 2, total: 50, correct: 36 }],
  prefs: {
    filter: {
      domains: ['store'],
      services: [],
      markedOnly: false,
      minWrong: 2,
      unansweredOnly: false,
    },
    count: 20,
  },
};

describe('loadData / saveData', () => {
  it('保存したデータを、次回の起動時に同じ内容で読み込む', () => {
    const storage = new MemoryStorage();
    expect(saveData(sample, storage)).toBe(true);
    expect(loadData(storage)).toEqual(sample);
  });

  it('以前の版が保存したデータを、同じ内容で読み込む', () => {
    const storage = new MemoryStorage();
    storage.setItem('pde-quiz:v1', JSON.stringify(savedByEarlierVersion));
    expect(loadData(storage)).toEqual(sample);
  });

  it('保存データがない・壊れている場合は、初期状態で起動する', () => {
    const storage = new MemoryStorage();
    expect(loadData(storage)).toEqual(DEFAULT_DATA);
    storage.setItem('pde-quiz:v1', '{壊れたJSON');
    expect(loadData(storage)).toEqual(DEFAULT_DATA);
  });

  it('保存領域が使えない場合も、例外を出さずに初期状態で起動する', () => {
    const broken = new MemoryStorage();
    broken.getItem = () => {
      throw new Error('denied');
    };
    broken.setItem = () => {
      throw new Error('quota');
    };
    expect(loadData(broken)).toEqual(DEFAULT_DATA);
    expect(saveData(sample, broken)).toBe(false);
  });
});

describe('exportData / importData', () => {
  it('書き出したデータを読み込むと、元のデータに戻る', () => {
    const result = importData(exportData(sample, 0));
    expect(result).toEqual({ ok: true, data: sample });
  });

  it('以前の版で書き出したファイルを、同じ内容で読み込む', () => {
    const file = {
      app: 'pde-quiz',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      ...savedByEarlierVersion,
    };
    expect(importData(JSON.stringify(file))).toEqual({ ok: true, data: sample });
  });

  // 読み込めなかった理由は、データの画面にそのまま表示する
  it('JSON でないデータは読み込まず、JSON として読み込めなかったと知らせる', () => {
    expect(importData('hello')).toEqual({
      ok: false,
      message: 'JSON として読み込めませんでした。',
    });
  });

  it('このアプリ以外で作られたデータは読み込まず、このアプリのデータではないと知らせる', () => {
    expect(importData(JSON.stringify({ ...sample, app: 'other', version: 1 }))).toEqual({
      ok: false,
      message: 'このアプリで書き出したデータではありません。',
    });
  });

  it('成績の値が不正なデータは読み込まず、形式が正しくないと知らせる', () => {
    const bad = JSON.parse(exportData(sample, 0));
    bad.progress.stats['design-security-001'].wrong = -1;
    expect(importData(JSON.stringify(bad))).toEqual({
      ok: false,
      message: 'データの形式が正しくありません。',
    });
  });
});

describe('addHistory', () => {
  it('新しい結果を先頭に追加し、最大30件まで残す', () => {
    const item = (n: number): SessionSummary => ({
      mode: 'practice',
      startedAt: n,
      finishedAt: n,
      total: 10,
      correct: 5,
    });
    let history: SessionSummary[] = [];
    for (let i = 1; i <= 31; i++) history = addHistory(history, item(i));
    expect(history).toHaveLength(30);
    expect(history[0]?.finishedAt).toBe(31);
    expect(history.at(-1)?.finishedAt).toBe(2);
  });
});

describe('出題数の設定', () => {
  it('選べる出題数（3問など）は、保存して次回もそのまま読み込む', () => {
    const storage = new MemoryStorage();
    saveData({ ...sample, prefs: { ...sample.prefs, count: 3 } }, storage);
    expect(loadData(storage).prefs.count).toBe(3);
  });

  it('選べない出題数が保存されていたら、既定の出題数に戻す', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'pde-quiz:v1',
      JSON.stringify({ ...sample, prefs: { ...sample.prefs, count: 7 } }),
    );
    expect(loadData(storage).prefs.count).toBe(DEFAULT_DATA.prefs.count);
  });
});
