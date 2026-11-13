'use client';

import * as React from 'react';
import { HexColorPicker } from 'react-colorful';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Input } from './input';
import { cn } from '../lib/utils';

const DEFAULT_PRESETS = [
  '#2563EB', // Blue
  '#7C3AED', // Violet
  '#059669', // Emerald
  '#DC2626', // Red
  '#D97706', // Amber
  '#0891B2', // Cyan
  '#4F46E5', // Indigo
  '#BE185D', // Pink
];

interface ColorPickerProps {
  value?: string | null;
  onChange: (color: string | null) => void;
  presets?: string[];
  className?: string;
}

export function ColorPicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  className,
}: ColorPickerProps) {
  const [inputValue, setInputValue] = React.useState(value || '');
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  const handleHexInput = (hex: string) => {
    setInputValue(hex);
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      onChange(hex);
    }
  };

  const handlePickerChange = (color: string) => {
    const upper = color.toUpperCase();
    setInputValue(upper);
    onChange(upper);
  };

  const handlePresetClick = (color: string) => {
    setInputValue(color);
    onChange(color);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-input-background px-3 py-1 text-sm transition-colors',
            'hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          {value ? (
            <>
              <span
                className="h-5 w-5 shrink-0 rounded border border-border"
                style={{ backgroundColor: value }}
              />
              <span className="text-foreground font-mono text-xs">{value}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Select color...</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[232px] p-3" align="start">
        <div className="space-y-3">
          <HexColorPicker
            color={value || '#2563EB'}
            onChange={handlePickerChange}
            style={{ width: '100%', height: '160px' }}
          />
          <Input
            value={inputValue}
            onChange={(e) => handleHexInput(e.target.value)}
            placeholder="#000000"
            className="h-8 font-mono text-xs"
          />
          <div className="flex flex-wrap gap-1.5">
            {presets.map((color) => (
              <button
                key={color}
                type="button"
                className={cn(
                  'h-6 w-6 rounded border border-border transition-transform hover:scale-110',
                  value === color && 'ring-2 ring-ring ring-offset-1',
                )}
                style={{ backgroundColor: color }}
                onClick={() => handlePresetClick(color)}
                title={color}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
