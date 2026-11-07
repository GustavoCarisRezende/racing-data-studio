export type SearchableEvent = { round: string; raceName: string; Circuit?: { circuitName?: string } };

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Filter only the local calendar; keep provider text unchanged for display. */
export function filterEvents<T extends SearchableEvent>(events: T[], query: string): T[] {
  const term = normalize(query);
  if (!term) return events;
  return events.filter((event) => [event.raceName, event.Circuit?.circuitName ?? '', event.round, `r${event.round}`, `round ${event.round}`, `rodada ${event.round}`]
    .some((field) => normalize(field).includes(term)));
}
