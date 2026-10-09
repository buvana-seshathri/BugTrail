import { useState } from 'react';
import { Icon } from './Icon';

/** Copies text (computed lazily) to the clipboard and confirms briefly. */
export function CopyButton({ text, label, primary }: { text: () => string; label: string; primary?: boolean }) {
  const [done, setDone] = useState<'ok' | 'fail' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setDone('ok');
    } catch {
      setDone('fail');
    }
    setTimeout(() => setDone(null), 1600);
  };
  return (
    <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`} onClick={copy}>
      <Icon name="copy" size={14} />
      <span aria-live="polite">{done === 'ok' ? 'Copied' : done === 'fail' ? 'Copy failed' : label}</span>
    </button>
  );
}
