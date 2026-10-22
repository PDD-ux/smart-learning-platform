import { apiRequest } from './api';
import type { TeacherOverview } from '@/lib/classrooms/teacher-overview';

export const teacher = {
  overview: (): Promise<TeacherOverview> => apiRequest('/api/teacher/overview'),
};
