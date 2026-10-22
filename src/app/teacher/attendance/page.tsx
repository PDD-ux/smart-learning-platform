import type { ReactElement } from 'react';

import { AttendanceSettings } from '@/components/attendance/AttendanceSettings';
import { TeacherShell } from '@/components/teacher/TeacherShell';

export default function TeacherAttendancePage(): ReactElement {
  return <TeacherShell><AttendanceSettings audience="teacher" /></TeacherShell>;
}
