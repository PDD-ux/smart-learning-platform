import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WatchedNoteBody } from '@/components/study/WatchedNoteBody';

afterEach(cleanup);
it('renders generated note headings, bullets and source labels separately', (): void => {
  render(<WatchedNoteBody markdown={'### 逻辑填空\n\n先判断上下文。\n- 注意转折\n- 核对主语\n\n来源：0:25、0:42'} />);
  expect(screen.getByRole('heading', { name: '逻辑填空', level: 3 })).toBeTruthy();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByText('来源：0:25、0:42')).toBeTruthy();
  expect(screen.queryByText('### 逻辑填空')).toBeNull();
});
it('keeps model HTML and unknown link formats as escaped text', (): void => {
  const raw = '<img src=x onerror=alert(1)>\n[不要执行](javascript:alert(1))';
  const { container } = render(<WatchedNoteBody markdown={raw} />);
  expect(container.querySelector('img')).toBeNull(); expect(container.querySelector('a')).toBeNull();
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(screen.getByText('[不要执行](javascript:alert(1))')).toBeTruthy();
});
