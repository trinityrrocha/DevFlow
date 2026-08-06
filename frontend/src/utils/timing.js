export const MAX_ESTIMATE_SECONDS = 365 * 24 * 60 * 60;

export function parseDurationInput(value) {
  const match = String(value || '').trim().match(/^(\d{2,3})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, daysValue, hoursValue, minutesValue] = match;
  const days = Number(daysValue); const hours = Number(hoursValue); const minutes = Number(minutesValue);
  if (hours > 23 || minutes > 59) return null;
  const seconds = days * 86400 + hours * 3600 + minutes * 60;
  return seconds >= 60 && seconds <= MAX_ESTIMATE_SECONDS ? seconds : null;
}

export function durationInput(seconds) {
  if (seconds == null) return '';
  const total = Math.max(0, Number(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${String(days).padStart(2, '0')}-${String(hours).padStart(2, '0')}-${String(minutes).padStart(2, '0')}`;
}

export function formatSignedDuration(seconds) {
  if (seconds == null) return 'Nao definida';
  const sign = Number(seconds) < 0 ? '-' : '';
  const total = Math.abs(Math.trunc(Number(seconds)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${sign}${days}d ${hours}h ${minutes}min`;
}
