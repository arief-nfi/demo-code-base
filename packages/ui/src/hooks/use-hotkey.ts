'use client';

import { useEffect } from 'react';

interface HotkeyDef {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * Parse a hotkey string like "mod+k", "mod+shift+n", "/", "escape"
 */
function parseHotkey(hotkey: string): HotkeyDef {
  const parts = hotkey.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  return {
    key,
    mod: parts.includes('mod'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
  };
}

/**
 * Hook for declarative keyboard shortcut handling.
 *
 * @example
 * useHotkey('mod+k', () => setOpen(true));
 * useHotkey('/', () => searchRef.current?.focus());
 * useHotkey('escape', () => setOpen(false));
 */
export function useHotkey(
  hotkey: string,
  callback: (e: KeyboardEvent) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;

    const def = parseHotkey(hotkey);

    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs/textareas (unless it's a mod combo)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInput && !def.mod) return;

      const modPressed = e.metaKey || e.ctrlKey;

      if (def.mod && !modPressed) return;
      if (!def.mod && modPressed) return;
      if (def.shift && !e.shiftKey) return;
      if (def.alt && !e.altKey) return;

      if (e.key.toLowerCase() === def.key || e.code.toLowerCase() === `key${def.key}`) {
        e.preventDefault();
        callback(e);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hotkey, callback, enabled]);
}
