import type { ReactElement } from 'react';
import { AssignmentWorkspace } from '@/components/classrooms/AssignmentWorkspace';

export default async function Page({ params }: { params: Promise<{ id: string }> }): Promise<ReactElement> {
  const { id } = await params;
  return <AssignmentWorkspace key={id} id={id} management teacher />;
}
