import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Question } from '../data/types.ts';
import { makeQuestion } from '../test-helpers.ts';
import { QuestionView } from './QuestionView.tsx';

afterEach(cleanup);

/** 選んだ選択肢を保持して、利用者が選択肢を順にタップしたときの表示を確かめる */
function Selectable({ question }: { question: Question }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <QuestionView
      question={question}
      order={question.choices.map((c) => c.key)}
      selected={selected}
      onSelect={setSelected}
      revealed={false}
    />
  );
}

const tap = (text: string) =>
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${text}$`) }));
const selectedTexts = () =>
  screen.queryAllByRole('button', { pressed: true }).map((b) => b.textContent?.slice(1));

describe('選択肢の選択', () => {
  it('単一選択では、別の選択肢をタップすると選び直しになる', () => {
    render(<Selectable question={makeQuestion('s1')} />);
    tap('選択肢 a');
    tap('選択肢 b');
    expect(selectedTexts()).toEqual(['選択肢 b']);
  });

  it('複数選択では、正解の数より多くは選べず、選んだ選択肢を外すと別の選択肢を選べる', () => {
    const question = makeQuestion('m1', {
      type: 'multiple',
      keys: ['a', 'b', 'c', 'd', 'e'],
      answer: ['a', 'c'],
    });
    render(<Selectable question={question} />);
    tap('選択肢 a');
    tap('選択肢 b');
    tap('選択肢 c');
    expect(selectedTexts()).toEqual(['選択肢 a', '選択肢 b']);

    tap('選択肢 a');
    tap('選択肢 c');
    expect(selectedTexts()).toEqual(['選択肢 b', '選択肢 c']);
  });
});
