import { createElement, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ClassDetail, ClassSources } from '@/lib/classrooms/contracts';
import type { TeacherOverview } from '@/lib/classrooms/teacher-overview';

const mocks = vi.hoisted(() => ({ overview: vi.fn(), classroomRead: vi.fn(), classroomSources: vi.fn(), push: vi.fn() }));

type TestLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode };
vi.mock('next/link', () => ({ default: function TestLink({ children, ...props }: TestLinkProps): ReturnType<typeof createElement> { return createElement('a', props, children); } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/components/teacher/TeacherShell', () => ({ TeacherShell: ({ children }: { children: ReactNode }): ReturnType<typeof createElement> => createElement('div', null, children) }));
vi.mock('@/services/teacher', () => ({ teacher: { overview: mocks.overview } }));
vi.mock('@/services/classrooms', () => ({ classrooms: { read: mocks.classroomRead, sources: mocks.classroomSources } }));

import TeacherOverviewPage from '@/app/teacher/page';
import { ClassroomDetail } from '@/components/classrooms/ClassroomWorkspace';

const overview = {
  generatedAt: '2026-10-21T08:00:00.000Z',
  summary: { classroomCount: 1, activeClassroomCount: 1, assignmentCount: 2, pendingReviewCount: 1 },
  classrooms: [{ id: 'course-1', title: '高等数学一班', state: 'ACTIVE' as const, activeMembers: 12, assignmentCount: 2, pendingReviewCount: 1 }],
  reviewQueue: [],
  recentAssignments: [],
} satisfies TeacherOverview;

const detail = {
  classroom: { id: 'course-1', title: '高等数学一班', description: '函数与映射课程', state: 'ACTIVE', revision: 1 },
  canManage: true,
  memberCount: 12,
  chapters: [{ id: 'chapter-1', title: '函数基础', body: '函数概念', sequence: 0, state: 'PUBLISHED', revision: 1, sharedCourseId: null, sourceAvailable: false }],
  assignments: [{ id: 'task-1', chapterId: 'chapter-1', title: '函数练习', instructions: '完成练习', state: 'PUBLISHED', dueAt: null, revision: 1 }],
  members: [],
  invites: [],
} satisfies ClassDetail;

const sources = { items: [], page: 1, hasMore: false } satisfies ClassSources;

describe('teacher course center', () => {
  beforeEach(() => {
    mocks.overview.mockReset().mockResolvedValue(overview);
    mocks.classroomRead.mockReset().mockResolvedValue(detail);
    mocks.classroomSources.mockReset().mockResolvedValue(sources);
    mocks.push.mockReset();
  });

  afterEach(() => cleanup());

  it('shows each owned classroom as a course card with real counts and a course-space link', async () => {
    render(createElement(TeacherOverviewPage));
    expect(await screen.findByRole('heading', { name: /我的课程/ })).toBeTruthy();
    expect(screen.getByText('高等数学一班')).toBeTruthy();
    expect(screen.getByText('有效学生')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByRole('link', { name: '进入课程空间' }).getAttribute('href')).toBe('/teacher/classes/course-1');
    expect(screen.queryByText('还没有课程')).toBeNull();
  });

  it('opens the teacher course overview first and switches into existing chapter content', async () => {
    render(createElement(ClassroomDetail, { id: 'course-1', portal: 'teacher' }));
    expect(await screen.findByRole('heading', { name: '课程概览' })).toBeTruthy();
    expect(screen.getAllByText('函数与映射课程').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: '课程章节' }));
    expect(await screen.findByRole('heading', { name: '课程章节 · 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '1. 函数基础' })).toBeTruthy();
    expect(mocks.classroomRead).toHaveBeenCalledWith('course-1');
  });
});
