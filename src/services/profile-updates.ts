/** Page-local invalidation only: no profile, token, or other user data in the event. */
const PROFILE_UPDATED = 'smart-learning-profile-updated';

export function notifyProfileUpdated(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PROFILE_UPDATED));
}

export function subscribeProfileUpdates(listener: () => void): () => void {
  if (typeof window === 'undefined') return (): void => undefined;
  window.addEventListener(PROFILE_UPDATED, listener);
  return (): void => window.removeEventListener(PROFILE_UPDATED, listener);
}
