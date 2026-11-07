import type { Locale } from '../../i18n/messages';

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function dateParts(year: string, month: string, day: string, locale: Locale): string {
  return locale === 'pt-BR' ? `${day}/${month}/${year}` : `${year}/${month}/${day}`;
}

// Calendar dates are civil dates, never instants: do not pass them through Date.
export function formatDate(value: string | null | undefined, locale: Locale): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || !validDate(Number(match[1]), Number(match[2]), Number(match[3]))) return value;
  return dateParts(match[1], match[2], match[3], locale);
}

// Snapshot timestamps are instants. Always display them in UTC, independently
// of the machine timezone; retain invalid input verbatim rather than guessing.
export function formatTimestamp(value: string | null | undefined, locale: Locale): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match || !validDate(Number(match[1]), Number(match[2]), Number(match[3])) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return value;
  if (match[7].toUpperCase() !== 'Z' && (Number(match[7].slice(1, 3)) > 23 || Number(match[7].slice(4, 6)) > 59)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return value;
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const time = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()].map((part) => String(part).padStart(2, '0')).join(':');
  const millis = date.getUTCMilliseconds();
  return `${dateParts(year, month, day, locale)} ${time}${millis ? `.${String(millis).padStart(3, '0')}` : ''}`;
}
