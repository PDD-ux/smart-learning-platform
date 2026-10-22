import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { ReactElement } from 'react';

type Page = { default: () => ReactElement };
const modules = import.meta.glob<Page>('../../../src/app/**/page.tsx');
const paths = Object.keys(modules).filter((path): boolean => /\/app\/(?:admin\/)?(?:exams|exam-attempts|exam-bank|exam-papers)(?:\/|$)/u.test(path));
afterEach(cleanup);

it('covers the eight old pages instead of dropping all former page coverage', (): void => {
  expect(paths).toHaveLength(8);
});

it.each(paths)('%s shows only the retirement notice without fetching records', async (path): Promise<void> => {
  const Page = (await modules[path]()).default;
  render(<Page />);
  expect(screen.getByRole('heading', { level: 1, name: '试卷功能已下线' })).toBeTruthy();
  expect(screen.getByText(/历史答卷与成绩仍保留/)).toBeTruthy();
  expect(screen.getAllByRole('link').map((link): string | null => link.getAttribute('href'))).toEqual(['/import', '/dashboard']);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

