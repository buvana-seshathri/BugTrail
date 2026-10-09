import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'bugtrail.theme';

function apply(pref: ThemePreference) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

/** Theme preference shared by every BugTrail page, stored in `chrome.storage.local`. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePreference>('system');

  useEffect(() => {
    chrome.storage.local
      .get(KEY)
      .then((v) => {
        const stored = v[KEY] as ThemePreference | undefined;
        if (stored) {
          setPref(stored);
          apply(stored);
        }
      })
      .catch(() => {});
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[KEY]) {
        const next = (changes[KEY].newValue as ThemePreference) ?? 'system';
        setPref(next);
        apply(next);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const cycle = useCallback(() => {
    const next: ThemePreference = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
    setPref(next);
    apply(next);
    chrome.storage.local.set({ [KEY]: next }).catch(() => {});
  }, [pref]);

  return { pref, cycle };
}
