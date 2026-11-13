'use client';

import { useRef, useEffect, useCallback } from 'react';

interface TemplateCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string;
  readOnly?: boolean;
}

export const TemplateCodeEditor = ({
  value,
  onChange,
  height = '400px',
  readOnly = false,
}: TemplateCodeEditorProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current && textareaRef.current.value !== value) {
      textareaRef.current.value = value;
    }
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = textareaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = value.substring(0, start) + '  ' + value.substring(end);
        onChange(newValue);

        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
      }
    },
    [value, onChange],
  );

  const insertAtCursor = useCallback(
    (text: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = value.substring(0, start) + text + value.substring(end);
      onChange(newValue);

      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.focus();
      });
    },
    [value, onChange],
  );

  // Expose insertAtCursor via a data attribute so parent can call it
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      (textarea as any).__insertAtCursor = insertAtCursor;
    }
  }, [insertAtCursor]);

  return (
    <div className="relative border border-border rounded-md overflow-hidden bg-[#1e1e2e]">
      <textarea
        ref={textareaRef}
        defaultValue={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
        spellCheck={false}
        className="w-full resize-none font-mono text-sm leading-relaxed p-4 bg-transparent text-[#cdd6f4] outline-none"
        style={{ height, tabSize: 2 }}
        placeholder="Enter template HTML..."
      />
    </div>
  );
};
