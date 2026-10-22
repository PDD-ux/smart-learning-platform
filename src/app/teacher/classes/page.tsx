import type { ReactElement } from 'react';
import { ClassroomList } from '@/components/classrooms/ClassroomWorkspace';

export default function Page(): ReactElement { return <ClassroomList portal="teacher" />; }
