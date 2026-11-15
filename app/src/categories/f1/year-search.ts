export function filterYears(years: number[], query: string): number[] {
  const normalized = query.replace(/\D/g, '').slice(0, 4);
  return years.filter((year) => String(year).includes(normalized));
}

export function filterSyncYears(years: number[], query: string, onlyMissing: boolean, importedYears: number[] | null): number[] {
  const matches = filterYears(years, query);
  if (!onlyMissing) return matches;
  return importedYears ? matches.filter((year) => !importedYears.includes(year)) : [];
}

export function isYearChoiceValid(year: number, filteredYears: number[]): boolean {
  return filteredYears.includes(year);
}
