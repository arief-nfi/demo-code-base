/**
 * Format an invoice amount in its own currency (not the tenant's display
 * preference — see formatCurrency for that): IDR `Rp 150.000`, USD `$12.00`,
 * anything else `EUR 5.00`.
 */
export function formatMoney(amount: number | string, currency: string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '';

  if (currency === 'IDR') {
    return `Rp ${group(Math.round(value).toString(), '.')}`;
  }

  const [int, frac] = value.toFixed(2).split('.');
  const formatted = `${group(int, ',')}.${frac}`;
  return currency === 'USD' ? `$${formatted}` : `${currency} ${formatted}`;
}

function group(digits: string, separator: string): string {
  const negative = digits.startsWith('-');
  const body = negative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return negative ? `-${grouped}` : grouped;
}
