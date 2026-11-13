import Handlebars from 'handlebars';

/** padStart never pads beyond this many characters */
export const MAX_PAD_LENGTH = 1000;

/** Formatting helpers shared by document and email templates. */
export function registerFormattingHelpers(hbs: typeof Handlebars): void {
  hbs.registerHelper('formatCurrency', (amount: number, currencyCode?: string) => {
    const currency = typeof currencyCode === 'string' ? currencyCode : 'USD';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount || 0);
    } catch {
      return `${currency} ${(amount || 0).toFixed(2)}`;
    }
  });

  hbs.registerHelper('formatNumber', (value: number, decimals?: number) => {
    const dec = typeof decimals === 'number' ? decimals : 2;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    }).format(value || 0);
  });

  hbs.registerHelper('formatDate', (dateStr: string, format?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const fmt = typeof format === 'string' ? format : 'YYYY-MM-DD';

    const pad = (n: number) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    return fmt
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
  });

  hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hbs.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
  hbs.registerHelper('gt', (a: number, b: number) => a > b);
  hbs.registerHelper('lt', (a: number, b: number) => a < b);
  hbs.registerHelper('gte', (a: number, b: number) => a >= b);
  hbs.registerHelper('lte', (a: number, b: number) => a <= b);

  hbs.registerHelper('add', (a: number, b: number) => (a || 0) + (b || 0));
  hbs.registerHelper('subtract', (a: number, b: number) => (a || 0) - (b || 0));
  hbs.registerHelper('multiply', (a: number, b: number) => (a || 0) * (b || 0));
  hbs.registerHelper('divide', (a: number, b: number) => b ? (a || 0) / b : 0);

  hbs.registerHelper('uppercase', (str: string) => (str || '').toUpperCase());
  hbs.registerHelper('lowercase', (str: string) => (str || '').toLowerCase());
  hbs.registerHelper('capitalize', (str: string) => {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  });

  hbs.registerHelper('ifCond', function (this: unknown, v1: unknown, operator: string, v2: unknown, options: Handlebars.HelperOptions) {
    switch (operator) {
      case '==': return v1 == v2 ? options.fn(this) : options.inverse(this);
      case '===': return v1 === v2 ? options.fn(this) : options.inverse(this);
      case '!=': return v1 != v2 ? options.fn(this) : options.inverse(this);
      case '<': return (v1 as number) < (v2 as number) ? options.fn(this) : options.inverse(this);
      case '>': return (v1 as number) > (v2 as number) ? options.fn(this) : options.inverse(this);
      case '<=': return (v1 as number) <= (v2 as number) ? options.fn(this) : options.inverse(this);
      case '>=': return (v1 as number) >= (v2 as number) ? options.fn(this) : options.inverse(this);
      case '&&': return v1 && v2 ? options.fn(this) : options.inverse(this);
      case '||': return v1 || v2 ? options.fn(this) : options.inverse(this);
      default: return options.inverse(this);
    }
  });

  hbs.registerHelper('inc', (value: number) => (value || 0) + 1);

  hbs.registerHelper('padStart', (value: unknown, length: number, char?: string) => {
    const padChar = typeof char === 'string' ? char : '0';
    // Capped: template authors (tenants) choose the length, and one render must not build a huge string
    const target = Math.min(Math.max(0, Number(length) || 0), MAX_PAD_LENGTH);
    return String(value || '').padStart(target, padChar);
  });

  hbs.registerHelper('json', (context: unknown) => JSON.stringify(context, null, 2));
}
