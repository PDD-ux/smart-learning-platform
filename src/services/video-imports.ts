import { apiRequest } from './api';
import { urlImports } from './url-imports';
import type { UrlDraftView } from '@/lib/url-imports/contracts';

export const videoImports = {
  import: (requestId: string, url: string, signal?: AbortSignal): Promise<UrlDraftView> => apiRequest('/api/video-imports', { method: 'POST', body: { requestId, url, confirmed: true }, signal }),
  read: urlImports.read,
  cancel: urlImports.cancel,
};
