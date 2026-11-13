/** Invented people/teams/results. Never load, fetch or modify an actual snapshot. */
export const syntheticSnapshots = [2024, 2025].map((year, index) => ({
  year, id: String(index + 1), storedAt: '2026-01-02T00:00:00Z', sourceDataAt: '2026-01-01T00:00:00Z',
  calendar: Array.from({ length: 14 }, (_, index) => ({ round: String(index + 1), date: new Date(Date.UTC(year, 2, index * 2 + 2)).toISOString().slice(0, 10), time: '14:00:00Z', sprintDate: (index + 1) % 4 === 0 ? new Date(Date.UTC(year, 2, index * 2 + 1)).toISOString().slice(0, 10) : null, sprintTime: (index + 1) % 4 === 0 ? '12:00:00Z' : null })),
  results: Array.from({ length: 14 }, (_, i) => i + 1).flatMap(round => ['results', ...(round % 4 === 0 ? ['sprint'] : [])].flatMap(session => [
    ['ana_test', 'Ana', 'Lima', 'aurora_test', 'Aurora Motors'],
    ['bruno_test', 'Bruno', 'Reis', 'boreal_test', 'Boreal Racing'],
    ['clara_test', 'Clara', 'Souza', 'aurora_test', 'Aurora Motors'],
  ].map(([driverId, givenName, familyName, constructorId, name], driverIndex) => ({
    round: String(round), session,
    result: { Driver: { driverId, givenName, familyName }, Constructor: { constructorId, name }, points: String(session === 'sprint' ? Math.max(0, 8 - driverIndex - round % 3) : Math.max(0, 25 - driverIndex * 5 - (round + driverIndex + year) % 7)) },
  })))),
}));
