import { apiRequest } from './api';
import type { ClassList, ClassDetail, ClassResult, ClassSources, CreateClass, JoinClass, ClassCommand } from '@/lib/classrooms/contracts';
export const classrooms = {
 list: (page = 1): Promise<ClassList> => apiRequest('/api/classes?page=' + page),
 read: (id: string): Promise<ClassDetail> => apiRequest('/api/classes/' + encodeURIComponent(id)),
 sources: (id: string, page = 1): Promise<ClassSources> => apiRequest('/api/classes/' + encodeURIComponent(id) + '/sources?page=' + page),
 create: (input: CreateClass): Promise<ClassResult> => apiRequest('/api/classes', { method: 'POST', body: input }),
 join: (input: JoinClass): Promise<ClassResult> => apiRequest('/api/classes/join', { method: 'POST', body: input }),
 command: (id: string, input: ClassCommand): Promise<ClassResult> => apiRequest('/api/classes/' + encodeURIComponent(id), { method: 'POST', body: input }),
};
