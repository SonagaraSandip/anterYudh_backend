/**
 * Date helper utilities to prevent timezone shift bugs (e.g., UTC date shifting
 * late-night transactions in IST / local timezones).
 */

const pad = (n) => String(n).padStart(2, '0');

/**
 * Returns a 'YYYY-MM-DD' string in local time.
 * If input is already 'YYYY-MM-DD', returns it directly.
 * If input is undefined / null, returns today's local date.
 */
export function getLocalDateString(input) {
  if (!input) {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
  }

  const d = new Date(input);
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Returns a 'YYYY-MM-DD HH:mm:ss' MySQL DATETIME string in local time.
 */
export function getLocalMySQLDateTime(input) {
  if (!input) {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const now = new Date();
      return `${trimmed} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }
    if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
      // Parse without UTC converting
      const parts = trimmed.split('T');
      const datePart = parts[0];
      const timePart = parts[1].replace('Z', '').slice(0, 8);
      const timeFull = timePart.length === 5 ? `${timePart}:00` : timePart;
      return `${datePart} ${timeFull}`;
    }
  }

  const d = new Date(input);
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
