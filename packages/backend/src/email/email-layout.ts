import Handlebars from 'handlebars';

export interface EmailLayoutInput {
  bodyHtml: string;
  brandName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  footerText: string;
}

const DEFAULT_COLOR = '#4f46e5';
const escape = (value: string) => Handlebars.Utils.escapeExpression(value);

/** The tenant's brand colour if it is a hex colour, else the default: it goes into style attributes. */
const safeColor = (color?: string | null) => (color && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : DEFAULT_COLOR);

/** The one email-safe frame around every email: 600px tables and inline styles only. */
export function renderEmailLayout(input: EmailLayoutInput): string {
  const color = safeColor(input.primaryColor);
  const logo = input.logoUrl && /^https?:\/\//i.test(input.logoUrl)
    ? `<img src="${escape(input.logoUrl)}" alt="${escape(input.brandName)}" height="40" style="display:block;height:40px;border:0;margin:0 auto 8px auto;" />`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escape(input.brandName)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;">
<tr><td style="padding:24px 40px;text-align:center;border-bottom:4px solid ${color};">${logo}<div style="font-size:18px;font-weight:600;color:#111827;">${escape(input.brandName)}</div></td></tr>
<tr><td style="padding:32px 40px;color:#333333;font-size:15px;line-height:1.6;">${input.bodyHtml}</td></tr>
<tr><td style="padding:16px 40px 24px 40px;color:#999999;font-size:12px;text-align:center;">${escape(input.footerText)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** An email-safe button; `url` and `label` are escaped. */
export function renderEmailButton(url: string, label: string, color?: string | null): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:6px;background-color:${safeColor(color)};">` +
    `<a href="${escape(String(url ?? ''))}" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-weight:600;text-decoration:none;">${escape(String(label ?? ''))}</a>` +
    `</td></tr></table>`;
}
