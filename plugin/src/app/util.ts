/* eslint-disable no-bitwise, curly */
/** Small stable hash (djb2), for idempotency keys and line identities. */
export function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isoDay(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const dayTitle = (d: Date = new Date()) =>
  `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

export function clock(d: Date = new Date()): string {
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "3 days late", "today", "tomorrow", "in 4 days"; null without a deadline. */
export function dueLabel(deadline: string | null, today: string): string | null {
  if (!deadline) {
    return null;
  }
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${deadline}T00:00:00Z`)) / 86_400_000);
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return '1 day late';
  }
  if (days > 1) {
    return `${days} days late`;
  }
  return days === -1 ? 'tomorrow' : `in ${-days} days`;
}
