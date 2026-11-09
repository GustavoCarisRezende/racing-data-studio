/** Invented people/teams/results. Never load, fetch or modify an actual snapshot. */
export const syntheticSnapshots = [2024, 2025].map((year, index) => ({
  year, id: String(index + 1), storedAt: '2026-01-02T00:00:00Z', sourceDataAt: '2026-01-01T00:00:00Z',
  results: Array.from({ length: 14 }, (_, i) => i + 1).flatMap(round => ['results', ...(round % 4 === 0 ? ['sprint'] : [])].flatMap(session => [
    ['ana_test', 'Ana', 'Lima', 'aurora_test', 'Aurora Motors'],
    ['bruno_test', 'Bruno', 'Reis', 'boreal_test', 'Boreal Racing'],
    ['clara_test', 'Clara', 'Souza', 'aurora_test', 'Aurora Motors'],
  ].map(([driverId, givenName, familyName, constructorId, name], driverIndex) => ({
    round: String(round), session,
    result: { Driver: { driverId, givenName, familyName }, Constructor: { constructorId, name }, points: String(session === 'sprint' ? Math.max(0, 8 - driverIndex - round % 3) : Math.max(0, 25 - driverIndex * 5 - (round + driverIndex + year) % 7)) },
  })))),
}));
