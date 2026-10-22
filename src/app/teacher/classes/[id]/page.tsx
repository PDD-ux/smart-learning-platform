import type { ReactElement } from 'react';
import { ClassroomDetail } from '@/components/classrooms/ClassroomWorkspace';

export default async function Page({ params }: { params: Promise<{ id: string }> }): Promise<ReactElement> {
  const { id } = await params;
  return <ClassroomDetail key={id} id={id} portal="teacher" />;
}
