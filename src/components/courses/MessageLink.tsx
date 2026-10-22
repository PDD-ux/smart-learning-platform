'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { api, ApiClientError } from '@/services/api';
export function refreshMessageCount(): void { window.dispatchEvent(new Event('learner-messages-updated')); }
export function MessageLink(): ReactElement | null {
  const [count, setCount] = useState<number | null>(null), [available, setAvailable] = useState(false), [error, setError] = useState(false);
  useEffect((): (() => void) => {
    let active = true, generation = 0;
    const load = (): void => { const id = ++generation; void api.messages().then((result): void => { if (active && id === generation) { setAvailable(true); setCount(result.unreadCount); setError(false); } }).catch((cause: unknown): void => { if (active && id === generation) { if (cause instanceof ApiClientError && cause.status === 404) setAvailable(false); else { setAvailable(true); setError(true); setCount(null); } } }); };
    load(); const interval = window.setInterval(load, 60000); window.addEventListener('focus', load); window.addEventListener('learner-messages-updated', load);
    return (): void => { active = false; window.clearInterval(interval); window.removeEventListener('focus', load); window.removeEventListener('learner-messages-updated', load); };
  }, []);
  return available ? <Link className="learner-topbar-link" href="/messages" aria-label={error ? '消息，计数暂不可用' : `消息，${count ?? 0}条未读`}>消息{error ? ' · 暂不可用' : count !== null && count > 0 ? ` · ${count}` : ''}</Link> : null;
}
