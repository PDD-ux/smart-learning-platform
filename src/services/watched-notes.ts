import { apiRequest } from '@/services/api';
import type { WatchedNote } from '@/lib/domain/watched-notes';

export function generateWatchedNote(contentId: string, segmentIds: string[], throughSec: number): Promise<WatchedNote> {
  return apiRequest(`/api/contents/${encodeURIComponent(contentId)}/ai/watched-note`, { method: 'POST', body: { segmentIds, throughSec } });
}
