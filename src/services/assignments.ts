import { apiRequest } from './api';
import type { AssignmentView, AssignmentResult, AssignmentCommand, SubmissionDetail, SubmissionHistory, ReviewCommand, AttachmentIntent, AttachmentRemove } from '@/lib/classrooms/assignment-contracts';
export const assignments = {
 read: (id: string, page = 1): Promise<AssignmentView> => apiRequest('/api/class-assignments/'+encodeURIComponent(id)+'?page='+page),
 command: (id: string, input: AssignmentCommand): Promise<AssignmentResult> => apiRequest('/api/class-assignments/'+encodeURIComponent(id),{method:'POST',body:input}),
 submission: (id: string): Promise<SubmissionDetail> => apiRequest('/api/class-submissions/'+encodeURIComponent(id)),
 history: (page = 1): Promise<SubmissionHistory> => apiRequest('/api/class-submissions?page='+page),
 review: (id: string, input: ReviewCommand): Promise<AssignmentResult> => apiRequest('/api/class-submissions/'+encodeURIComponent(id),{method:'POST',body:input}),
 intent: (id: string, input: AttachmentIntent): Promise<AssignmentResult> => apiRequest('/api/class-submissions/'+encodeURIComponent(id)+'/attachments',{method:'POST',body:input}),
 upload: (id: string, file: File, signal?: AbortSignal): Promise<AssignmentResult> => apiRequest('/api/class-attachments/'+encodeURIComponent(id)+'/upload',{method:'POST',body:file,headers:{'Content-Type':file.type || 'application/octet-stream'},signal}),
 remove: (id: string,input: AttachmentRemove): Promise<AssignmentResult> => apiRequest('/api/class-attachments/'+encodeURIComponent(id),{method:'POST',body:input}),
 download: async (id: string): Promise<Blob> => { const proof = await apiRequest<{expires:number;sig:string}>('/api/class-attachments/'+encodeURIComponent(id)+'/download',{method:'POST'}); return apiRequest('/api/class-attachments/'+encodeURIComponent(id)+'/download/file',{method:'POST',body:{expires:proof.expires,sig:proof.sig},responseKind:'blob'}); },
 ticket: (id: string): Promise<{expires:number;sig:string;expiresInSec:number}> => apiRequest('/api/class-attachments/'+encodeURIComponent(id)+'/download',{method:'POST'}),
};

