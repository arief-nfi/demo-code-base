'use client';

import { Input, Label } from '@saas/ui';

interface PdfSettings {
  paperSize: string;
  orientation: string;
  marginTop: string;
  marginBottom: string;
  marginLeft: string;
  marginRight: string;
}

interface PdfSettingsPanelProps {
  settings: PdfSettings;
  onChange: (settings: PdfSettings) => void;
}

export const PdfSettingsPanel = ({ settings, onChange }: PdfSettingsPanelProps) => {
  const update = (field: keyof PdfSettings, value: string) => {
    onChange({ ...settings, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Paper Size</Label>
          <select
            value={settings.paperSize}
            onChange={(e) => update('paperSize', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
            <option value="Legal">Legal</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Orientation</Label>
          <select
            value={settings.orientation}
            onChange={(e) => update('orientation', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </div>
      </div>

      <div>
        <Label className="text-xs">Margins</Label>
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          <div>
            <span className="text-[10px] text-muted-foreground">Top</span>
            <Input
              value={settings.marginTop}
              onChange={(e) => update('marginTop', e.target.value)}
              placeholder="20mm"
              className="h-8 text-xs"
            />
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground">Bottom</span>
            <Input
              value={settings.marginBottom}
              onChange={(e) => update('marginBottom', e.target.value)}
              placeholder="20mm"
              className="h-8 text-xs"
            />
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground">Left</span>
            <Input
              value={settings.marginLeft}
              onChange={(e) => update('marginLeft', e.target.value)}
              placeholder="15mm"
              className="h-8 text-xs"
            />
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground">Right</span>
            <Input
              value={settings.marginRight}
              onChange={(e) => update('marginRight', e.target.value)}
              placeholder="15mm"
              className="h-8 text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
