import { apiRequest } from './api';
import type { LiveSessionDto } from '@/lib/domain/live-notes';
export const liveNotes = {
  list: (): Promise<Array<{ id: string; title: string; state: string; createdAt: string }>> => apiRequest('/api/live-notes'),
  create: (title: string): Promise<LiveSessionDto> => apiRequest('/api/live-notes', { method: 'POST', body: { title } }),
  read: (id: string): Promise<LiveSessionDto> => apiRequest(`/api/live-notes/${encodeURIComponent(id)}`),
  chunk: (id: string, sequence: number, pcmBase64: string): Promise<LiveSessionDto> => apiRequest(`/api/live-notes/${encodeURIComponent(id)}/chunks`, { method: 'POST', body: { sequence, pcmBase64 } }),
  highlights: (id: string): Promise<LiveSessionDto> => apiRequest(`/api/live-notes/${encodeURIComponent(id)}/highlights`, { method: 'POST', body: {} }),
  finish: (id: string, keepSuccessfulOnly = false): Promise<LiveSessionDto> => apiRequest(`/api/live-notes/${encodeURIComponent(id)}/finish`, { method: 'POST', body: { keepSuccessfulOnly } }),
};
