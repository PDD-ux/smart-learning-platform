'use client';

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';

export type XpParticleProps = {
  text: string;
  kind: 'xp' | 'streak';
  originRect: DOMRect;
  onDone: () => void;
};

export function XpParticle({ text, kind, originRect, onDone }: XpParticleProps): ReactElement | null {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(false);
      onDone();
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  if (!visible) return null;

  const style: CSSProperties = {
    left: `${originRect.left + originRect.width / 2}px`,
    top: `${originRect.top + originRect.height / 2}px`,
  };

  return (
    <span className={`xp-particle xp-particle-${kind}`} style={style} aria-live="polite">
      {text}
    </span>
  );
}
