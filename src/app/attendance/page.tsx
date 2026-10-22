import type { ReactElement } from 'react';

import { AppShell } from '@/components/app/AppShell';
import { AttendanceSettings } from '@/components/attendance/AttendanceSettings';

export default function AttendancePage(): ReactElement {
  return <AppShell title="登录与打卡设置" subtitle="管理可选的人脸登录，查看当天学习打卡。"><AttendanceSettings audience="student" /></AppShell>;
}
