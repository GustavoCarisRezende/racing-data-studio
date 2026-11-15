export type EventSchedule = {
  date: string | null | undefined;
  time?: string | null;
};

function isCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() === Number(month) - 1
    && parsed.getUTCDate() === Number(day);
}

function localCivilDate(now: Date): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function isFutureEvent(schedule: EventSchedule, now = new Date()): boolean {
  const { date, time } = schedule;
  if (!date || !isCivilDate(date)) return false;

  // The API's date may be a circuit-local civil date while its time is UTC.
  // When a timezone is explicit, the combined timestamp is authoritative even
  // if its UTC date differs from the machine's local calendar date.
  if (time && /^\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(time)) {
    const scheduled = Date.parse(`${date}T${time}`);
    if (Number.isFinite(scheduled)) return scheduled > now.getTime();
  }

  const today = localCivilDate(now);
  if (date > today) return true;
  return false;
}

export function isPendingEvent(
  schedule: EventSchedule,
  results: { round: string; type: string }[],
  round: string,
  now = new Date(),
): boolean {
  const hasLocalRaceOrSprint = results.some(
    (result) => result.round === round && (result.type === 'results' || result.type === 'sprint'),
  );
  return isFutureEvent(schedule, now) || !hasLocalRaceOrSprint;
}
