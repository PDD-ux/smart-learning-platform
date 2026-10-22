import type { ReactElement } from 'react';
import { SubmissionWorkspace } from '@/components/classrooms/AssignmentWorkspace';

export default async function Page({ params }: { params: Promise<{ id: string }> }): Promise<ReactElement> {
  const { id } = await params;
  return <SubmissionWorkspace key={id} id={id} management teacher />;
}
