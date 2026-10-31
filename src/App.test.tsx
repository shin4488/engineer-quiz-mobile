import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.tsx';

vi.mock('./data/questions.ts', async () => {
  const { makeQuestion } = await import('./test-helpers.ts');
  const QUESTIONS = [
    makeQuestion('t1', { domain: 'design' }),
    makeQuestion('t2', { domain: 'store' }),
    makeQuestion('t3', { domain: 'analyze' }),
  ];
  return { QUESTIONS, QUESTION_MAP: new Map(QUESTIONS.map((q) => [q.id, q])) };
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

/** 正解は常に「選択肢 a」。表示順はシャッフルされるため、文で選ぶ。 */
const answer = (correct: boolean) => {
  click(correct ? /選択肢 a/ : /選択肢 b/);
  click('回答する');
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('練習モード', () => {
  it('回答すると正誤と解説を表示し、最後に結果をまとめて表示する', () => {
    render(<App />);
    click('練習を始める');
    expect(screen.getByText('1 / 3')).toBeTruthy();

    answer(true);
    expect(screen.getByRole('status').textContent).toBe('正解');
    expect(screen.getByRole('region', { name: '解説' })).toBeTruthy();
    click('次の問題');

    answer(false);
    expect(screen.getByRole('status').textContent).toBe('不正解');
    click('☆ 後で見直す');
    click('次の問題');

    answer(true);
    click('結果を見る');
    expect(screen.getByText('練習の結果')).toBeTruthy();
    expect(screen.getByText(/3問中 2問 正解/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '間違えた1問をもう一度解く' })).toBeTruthy();
  });

  it('前の問題に戻ると、回答済みの結果と解説をもう一度見られる', () => {
    render(<App />);
    click('練習を始める');
    expect(screen.getByRole('button', { name: '前へ' })).toHaveProperty('disabled', true);

    answer(true);
    click('次の問題');
    expect(screen.getByText('2 / 3')).toBeTruthy();

    click('前へ');
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('正解');
    expect(screen.getByRole('region', { name: '解説' })).toBeTruthy();

    click('次の問題');
    expect(screen.getByText('2 / 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: '回答する' })).toBeTruthy();
  });

  it('間違えた回数と見直しの印で、次の出題を絞り込める', () => {
    render(<App />);
    click('練習を始める');
    answer(false);
    click('☆ 後で見直す');
    click('中断・終了のメニュー');
    click('中断してホームへ（あとで再開できます）');
    expect(screen.getByText('練習の途中です')).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    expect(screen.getByText(/条件に合う問題/).textContent).toContain('1問');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    expect(screen.getByText(/条件に合う問題/).textContent).toContain('0問');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } });

    fireEvent.click(screen.getByRole('checkbox', { name: /見直しの印を付けた問題だけ/ }));
    expect(screen.getByText(/条件に合う問題/).textContent).toContain('1問');

    // 分野の数字も、見直しの印を付けた1問だけを数える
    const domainCounts = [
      'データ処理システムの設計',
      'データの保存',
      '分析用データを準備して使用する',
    ].map((label) =>
      Number(
        screen
          .getByRole('button', { name: new RegExp(`^${label}`) })
          .textContent?.match(/\d+$/)?.[0],
      ),
    );
    expect(domainCounts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('中断した練習は、アプリを開き直しても続きから再開できる', () => {
    const first = render(<App />);
    click('練習を始める');
    answer(true);
    first.unmount();

    render(<App />);
    expect(screen.getByText('1 / 3問 回答済み')).toBeTruthy();
    click('続きから再開');
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('正解');
  });

  it('結果の画面から、間違えた問題だけをもう一度解ける', () => {
    render(<App />);
    click('練習を始める');
    answer(true);
    click('次の問題');
    const wrongQuestion = screen.getByText(/の問題文$/).textContent;
    answer(false);
    click('次の問題');
    answer(true);
    click('結果を見る');

    click('間違えた1問をもう一度解く');
    expect(screen.getByText('1 / 1')).toBeTruthy();
    expect(screen.getByText(/の問題文$/).textContent).toBe(wrongQuestion);
  });

  // 未回答の問題は間違えた回数が0回のため、両方を指定すると1問も当てはまらない
  it('間違えた回数と未回答の条件は、一方を指定するともう一方を解除する', () => {
    render(<App />);
    const minWrong = screen.getByRole('combobox');
    const unanswered = screen.getByRole('checkbox', { name: 'まだ解いていない問題だけ' });

    fireEvent.change(minWrong, { target: { value: '1' } });
    fireEvent.click(unanswered);
    expect(minWrong).toHaveProperty('value', '0');
    expect(unanswered).toHaveProperty('checked', true);

    fireEvent.change(minWrong, { target: { value: '2' } });
    expect(unanswered).toHaveProperty('checked', false);
  });
});

describe('問題のコピー', () => {
  it('ボタン1つで、画面に表示中の問題文と選択肢をコピーし、完了を知らせる', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App />);
    click('練習を始める');
    const shown = screen
      .getAllByRole('button', { name: /^[A-D]選択肢 / })
      .map((b) => b.textContent);

    fireEvent.click(screen.getByRole('button', { name: '問題と選択肢をコピー' }));
    expect(await screen.findByRole('button', { name: 'コピーしました' })).toBeTruthy();

    const text = writeText.mock.calls[0]?.[0] as string;
    expect(text.startsWith(screen.getByText(/の問題文$/).textContent ?? '')).toBe(true);
    // 画面と同じ順番・記号（A〜D）で選択肢が並ぶ
    expect(text).toContain(shown.map((t) => `${t?.slice(0, 1)}. ${t?.slice(1)}`).join('\n'));
  });

  it('コピー ボタンは選択肢の下に表示する', () => {
    render(<App />);
    click('練習を始める');
    const lastChoice = screen.getAllByRole('button', { name: /^[A-D]選択肢 / }).at(-1);
    const copy = screen.getByRole('button', { name: '問題と選択肢をコピー' });
    expect(lastChoice?.compareDocumentPosition(copy)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('模擬試験モード', () => {
  it('解説を出さずに回答を進め、採点すると結果を表示する', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // 時計を止め、残り時間が制限時間の120分ちょうどから始まることを確かめる
    vi.setSystemTime(new Date('2026-01-01T09:00:00+09:00'));
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: '模擬試験' }));
    click('模擬試験を始める');
    expect(screen.queryByRole('button', { name: '回答する' })).toBeNull();
    expect(screen.getByText('残り 2:00:00')).toBeTruthy();

    click(/選択肢 a/);
    expect(screen.queryByRole('region', { name: '解説' })).toBeNull();
    click('一覧');
    const dialog = screen.getByRole('dialog', { name: '問題の一覧' });
    fireEvent.click(within(dialog).getByRole('button', { name: '採点する' }));

    expect(screen.getByText('模擬試験の結果')).toBeTruthy();
    expect(screen.getByText(/3問中 1問 正解/)).toBeTruthy();
    expect(screen.getByText(/合格の目安（70%）まであと2問/)).toBeTruthy();
  });

  it('制限時間の120分になると、自動で採点して結果を表示する', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T09:00:00+09:00'));
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: '模擬試験' }));
    click('模擬試験を始める');
    click(/選択肢 a/);

    // 残り時間は1秒ごとに更新する。時計を終了の2秒前に進めてから、1秒ずつ時間を進める
    vi.setSystemTime(new Date('2026-01-01T10:59:58+09:00'));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('残り 0:01')).toBeTruthy();
    expect(screen.queryByText('模擬試験の結果')).toBeNull();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText('模擬試験の結果')).toBeTruthy();
    expect(screen.getByText(/3問中 1問 正解/)).toBeTruthy();
  });

  it('制限時間は中断中も進み、過ぎてから再開しようとすると採点した結果を表示する', () => {
    vi.setSystemTime(new Date('2026-01-01T09:00:00+09:00'));
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: '模擬試験' }));
    click('模擬試験を始める');
    click(/選択肢 a/);
    const leave = () => {
      click('中断・終了のメニュー');
      click('中断してホームへ（あとで再開できます）');
    };
    leave();

    vi.setSystemTime(new Date('2026-01-01T10:59:00+09:00'));
    click('続きから再開');
    expect(screen.getByText('残り 1:00')).toBeTruthy();
    leave();

    vi.setSystemTime(new Date('2026-01-01T11:00:00+09:00'));
    click('続きから再開');
    expect(screen.getByText('模擬試験の結果')).toBeTruthy();
    expect(screen.getByText(/3問中 1問 正解/)).toBeTruthy();
  });
});

describe('データ', () => {
  it('書き出したデータを貼り付けて読み込むと、全削除する前の成績・見直しの印・途中の問題に戻る', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    click('練習を始める');
    answer(false);
    click('☆ 後で見直す');
    click('中断・終了のメニュー');
    click('中断してホームへ（あとで再開できます）');
    click('データ');
    expect(screen.getByText('解いた問題 1問・見直しの印 1問')).toBeTruthy();

    click('クリップボードにコピー');
    await screen.findByText(/クリップボードにコピーしました/);
    const exported = writeText.mock.calls[0]?.[0] as string;

    click('すべてのデータを削除');
    expect(screen.getByText('解いた問題 0問・見直しの印 0問')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('コピーしたデータを貼り付け'), {
      target: { value: exported },
    });
    click('貼り付けたデータを読み込む');
    expect(screen.getByText('解いた問題 1問・見直しの印 1問')).toBeTruthy();
    click('出題');
    expect(screen.getByText('練習の途中です')).toBeTruthy();
  });
});
