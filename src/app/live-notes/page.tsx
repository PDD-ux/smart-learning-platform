import { redirect } from 'next/navigation';

// Avoid prerendered redirect HTML without a Location header in standalone output.
export const dynamic = 'force-dynamic';

/** Old microphone entry retired after the user clarified video playback. */
export default function RetiredLiveNotesPage(): never { redirect('/import'); }
