import { assertDataset, assertQuery, assertSelection, compareDecimal, isScalarOfType, SandboxError } from '@rds/sandbox-contracts';
import type { DatasetDescriptor, FacetRequest, Filter, QueryRequest, ResolvedSelection, RevisionReference, SandboxDataProvider, Scalar, SelectionRequest } from '@rds/sandbox-contracts';

type Snapshot = { year: number; id: string; storedAt: string; sourceDataAt: string; integrity?: { validatedEndpoints?: string[] }; calendar?: { round: string; raceName?: string | null; date: string | null; time: string | null; sprintDate: string | null; sprintTime: string | null }[]; results: { round: string; session: string; result: { Driver?: { driverId?: string; givenName?: string; familyName?: string }; Constructor?: { constructorId?: string; name?: string }; points?: string | null; grid?: unknown; position?: unknown; laps?: unknown } }[] };
type Row = Record<string, Scalar>;
type CatalogEntry = RevisionReference & { counts: { results: number; sprint: number }; hasTeams?: boolean };
type SnapshotReader = (revisions?: RevisionReference[]) => Promise<Snapshot[]>;
type CatalogReader = (revisions?: RevisionReference[]) => Promise<CatalogEntry[]>;
const snapshotRevision = (s: Snapshot): RevisionReference => ({
  partitionId: String(s.year), revisionId: s.id, sourceDataAt: s.sourceDataAt, storedAt: s.storedAt,
});
const revisionKey = (revisions: RevisionReference[]) => JSON.stringify(revisions.map(r => [r.partitionId, r.revisionId, r.sourceDataAt, r.storedAt]));
const text = (fallback: string, pt: string) => ({ fallback, translations: { 'pt-BR': pt } });
const dimensions = ['season', 'round', 'session', 'driver', 'team'];
const allSessionFilter = { fieldId: 'session', op: 'in' as const, values: ['results', 'sprint'] };
export const descriptor: DatasetDescriptor = {
  protocolVersion: 1, id: 'f1.session_results', schemaVersion: '1', semanticVersion: '1',
  label: text('F1 session results', 'Resultados de sessões F1'),
  description: text('Occurrences reported in locally imported race and sprint snapshots.', 'Ocorrências informadas nos snapshots locais de corridas e sprints.'),
  grain: text('One source result occurrence in a race or sprint.', 'Uma ocorrência de resultado da fonte em corrida ou sprint.'),
  fields: [
    { id: 'season', label: text('Season', 'Temporada'), type: 'string', role: 'dimension', analyticalType: 'ordinal', nullable: false, ordered: true, filters: ['in', 'contains'], availability: 'available' },
    { id: 'round', label: text('Round', 'Rodada'), type: 'integer', role: 'dimension', analyticalType: 'ordinal', nullable: false, ordered: true, filters: ['in', 'range'], availability: 'available', labelField: 'round_name' },
    { id: 'session', label: text('Session', 'Sessão'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: false, ordered: false, filters: ['in', 'contains'], availability: 'available', valueLabels: [{ value: 'results', label: text('Race', 'Corrida') }, { value: 'sprint', label: text('Sprint', 'Sprint') }] },
    { id: 'driver', label: text('Driver', 'Piloto'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: true, ordered: false, filters: ['in', 'contains', 'isNull', 'isNotNull'], availability: 'partial', labelField: 'driver_name' },
    { id: 'team', label: text('Team', 'Equipe'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: true, ordered: false, filters: ['in', 'contains', 'isNull', 'isNotNull'], availability: 'partial', labelField: 'team_name' },
    { id: 'driver_name', label: text('Driver name', 'Nome do piloto'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: true, ordered: false, filters: [], availability: 'partial' },
    { id: 'team_name', label: text('Team name', 'Nome da equipe'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: true, ordered: false, filters: [], availability: 'partial' },
    { id: 'round_name', label: text('Round and event', 'Rodada e evento'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: true, ordered: false, filters: [], availability: 'partial' },
    { id: 'points_raw', label: text('Reported points', 'Pontos informados'), type: 'decimal', role: 'measure', analyticalType: 'quantitative', nullable: true, ordered: true, filters: ['range', 'isNull', 'isNotNull'], availability: 'partial' },
    { id: 'grid_position_raw', label: text('Starting position', 'Posição de largada'), type: 'integer', role: 'measure', analyticalType: 'quantitative', nullable: true, ordered: true, filters: ['range', 'isNull', 'isNotNull'], availability: 'partial' },
    { id: 'finish_position_raw', label: text('Finish position', 'Posição final'), type: 'integer', role: 'measure', analyticalType: 'quantitative', nullable: true, ordered: true, filters: ['range', 'isNull', 'isNotNull'], availability: 'partial' },
    { id: 'position_balance_raw', label: text('Positions gained', 'Saldo de posições'), description: text('Starting position minus finish position; positive values mean positions gained. Missing either source position remains null.', 'Posição de largada menos posição final; valores positivos indicam posições ganhas. Se uma das posições de origem estiver ausente, o saldo permanece nulo.'), type: 'integer', role: 'measure', analyticalType: 'quantitative', nullable: true, ordered: true, filters: ['range', 'isNull', 'isNotNull'], availability: 'partial' },
    { id: 'laps_raw', label: text('Completed laps', 'Voltas completadas'), type: 'integer', role: 'measure', analyticalType: 'quantitative', nullable: true, ordered: true, filters: ['range', 'isNull', 'isNotNull'], availability: 'partial' },
    { id: 'occurrence_raw', label: text('Occurrence', 'Ocorrência'), type: 'integer', role: 'measure', analyticalType: 'quantitative', nullable: false, ordered: false, filters: [], availability: 'available' },
  ],
  metrics: [
    { id: 'points', label: text('Points', 'Pontos'), description: text('Source result points, not official championship standings. Missing values propagate. Means are rounded half away from zero to at least 12 fractional places, retaining source precision.', 'Pontos dos resultados da fonte; não são classificação oficial. Valores ausentes propagam. Médias são arredondadas para longe de zero em empates, com pelo menos 12 casas decimais e preservação da precisão da fonte.'), fieldId: 'points_raw', aggregations: ['sum', 'mean', 'min', 'max'], defaultAggregation: 'sum', groupableBy: dimensions, requiredDimensions: ['season'], nullPolicy: 'propagate', additive: true, supportsRunningSum: true },
    { id: 'grid_position', label: text('Starting position', 'Posição de largada'), description: text('Mean/minimum/maximum across source result occurrences, not an individual position. If race and sprint are explicitly unified, mean is across both sessions; raw occurrences are reaggregated.', 'Média/mínimo/máximo de ocorrências brutas, não uma posição individual. Se corrida e sprint forem unificadas explicitamente, a média considera ambas as sessões; as ocorrências brutas são reagrupadas.'), fieldId: 'grid_position_raw', aggregations: ['mean', 'min', 'max'], defaultAggregation: 'mean', groupableBy: dimensions, requiredDimensions: ['season', 'session'], nullPolicy: 'propagate', additive: false, supportsRunningSum: false },
    { id: 'finish_position', label: text('Finish position', 'Posição final'), description: text('Mean/minimum/maximum across source result occurrences, not an individual position. If race and sprint are explicitly unified, mean is across both sessions; raw occurrences are reaggregated.', 'Média/mínimo/máximo de ocorrências brutas, não uma posição individual. Se corrida e sprint forem unificadas explicitamente, a média considera ambas as sessões; as ocorrências brutas são reagrupadas.'), fieldId: 'finish_position_raw', aggregations: ['mean', 'min', 'max'], defaultAggregation: 'mean', groupableBy: dimensions, requiredDimensions: ['season', 'session'], nullPolicy: 'propagate', additive: false, supportsRunningSum: false },
    { id: 'position_balance', label: text('Positions gained', 'Saldo de posições'), description: text('Starting position minus finish position; positive values mean positions gained. Mean/minimum/maximum across occurrences, never an individual position; unified race/sprint values are reaggregated from raw occurrences.', 'Posição de largada menos posição final; valores positivos indicam posições ganhas. Média/mínimo/máximo de ocorrências, nunca uma posição individual; valores de corrida/sprint unificadas são reagrupados das ocorrências brutas.'), fieldId: 'position_balance_raw', aggregations: ['mean', 'min', 'max'], defaultAggregation: 'mean', groupableBy: dimensions, requiredDimensions: ['season', 'session'], nullPolicy: 'propagate', additive: false, supportsRunningSum: false },
    { id: 'laps', label: text('Completed laps', 'Voltas completadas'), description: text('Reported completed laps; zero is a valid value. Means are calculated from source result occurrences.', 'Voltas completadas informadas; zero é um valor válido. As médias são calculadas sobre ocorrências brutas de resultados.'), fieldId: 'laps_raw', aggregations: ['sum', 'mean', 'min', 'max'], defaultAggregation: 'sum', groupableBy: dimensions, requiredDimensions: ['season'], nullPolicy: 'propagate', additive: true, supportsRunningSum: false },
    { id: 'observations', label: text('Result occurrences', 'Ocorrências de resultado'), description: text('Number of source result occurrences.', 'Quantidade de ocorrências de resultado da fonte.'), fieldId: 'occurrence_raw', aggregations: ['count'], defaultAggregation: 'count', groupableBy: dimensions, requiredDimensions: ['season'], nullPolicy: 'ignore', additive: false, supportsRunningSum: false },
  ],
  sources: [{ name: 'Jolpica F1', attribution: 'Jolpica F1 API contributors', license: 'CC BY-NC-SA 4.0', url: 'https://github.com/jolpica/jolpica-f1' }],
  limitations: [text('Only imported results; missing events are not assumed to be zero. Points sums are not official standings. Team IDs do not imply historical continuity. Round does not identify the same circuit across seasons.', 'Somente resultados importados; eventos ausentes não são presumidos como zero. A soma de pontos não é classificação oficial. IDs de equipe não implicam continuidade histórica. Rodada não identifica o mesmo circuito entre temporadas.'), text('Only the all-sessions driver cumulative profile carries prior totals for past sessions with validated endpoint integrity and results for other drivers. The team profile does not carry absences because the missing team assignment is unknown. Unknown coverage and explicit null points remain gaps; source-side partial lists without an integrity signal cannot be detected. Session timestamps must be unambiguous. Population filters may exclude results.', 'Somente o perfil acumulado de piloto em todas as sessões carrega totais anteriores para sessões passadas com integridade do endpoint validada e resultados de outros pilotos. O perfil por equipe não carrega ausências porque a equipe do resultado ausente é desconhecida. Cobertura desconhecida e pontos explicitamente nulos continuam lacunas; listas parciais da fonte sem sinal de integridade não podem ser detectadas. Os horários das sessões devem ser inequívocos. Filtros de população podem excluir resultados.')],
  capabilities: { charts: ['table', 'line', 'bar', 'pie', 'scatter'], maxDimensions: 5, maxRows: 5000, maxSeries: 100, comparisonDimensions: ['season'], runningSum: true, completeGroupedQueries: true, latestSelection: true, multiSelection: { fieldId: 'season', maxValues: 20 }, eventUnification: { fieldId: 'session', requiredValues: ['results', 'sprint'] }, queryVersions: [1, 3], runningSumProfiles: [
    { version: 1, id: 'driver-all-sessions-v1', groupingFamily: 'driver-points-v1', groupingField: 'driver', label: text('Driver points by session', 'Pontos do piloto por sessão'), description: text('All prior sessions; validated past absences may carry the previous total, while unknown data remains a gap. Round and session only crop the display. Not official standings.', 'Todas as sessões anteriores; ausências passadas validadas podem carregar o total anterior, enquanto dados desconhecidos permanecem lacuna. Rodada e sessão apenas recortam a exibição. Não é classificação oficial.'), metricId: 'points', axisFieldId: 'round', dimensions: ['round', 'driver', 'season', 'session'], partitionBy: ['driver', 'season'], orderDimensions: ['round', 'session'], chronology: { id: 'validated-local-session-calendar-v1', missing: 'reject' }, displayFilterFields: ['round', 'session'] },
    { version: 1, id: 'driver-sessions-by-team-v1', groupingFamily: 'driver-points-v1', groupingField: 'team', label: text('Driver points by team and session', 'Pontos do piloto por equipe e sessão'), measureLabel: text('Points after the event', 'Pontos após o evento'), description: text('Team identifies each driver’s result in that session; values remain driver totals, never team totals. Team changes do not reset accumulation. Missing sessions are not carried because the absent result’s team assignment is unknown; ambiguous assignments are rejected.', 'Equipe identifica o resultado de cada piloto na sessão; valores são totais do piloto, nunca da equipe. Mudanças de equipe não reiniciam o acumulado. Sessões ausentes não são carregadas porque a equipe do resultado ausente é desconhecida; vínculos ambíguos são recusados.'), metricId: 'points', axisFieldId: 'round', dimensions: ['round', 'driver', 'season', 'session', 'team'], partitionBy: ['driver', 'season'], orderDimensions: ['round', 'session', 'team'], chronology: { id: 'validated-local-session-calendar-v1', missing: 'reject' }, displayFilterFields: ['round', 'session'] },
  ] },
  presentation: {
    primaryFilterFieldId: 'season',
    filters: [{ fieldId: 'driver', label: text('Drivers', 'Pilotos') }, { fieldId: 'team', label: text('Teams', 'Equipes') }, { fieldId: 'round', label: text('Rounds', 'Rodadas') }, { fieldId: 'session', label: text('Sessions', 'Sessões') }],
    defaultVisualization: { kind: 'line', x: 'round', metric: { metricId: 'points', aggregation: 'sum' }, series: 'driver', comparison: 'season', runningSum: false, unifyEvents: true, unifyLegends: true },
  },
};
// Preserve legacy literal-ID text filter semantics; name search belongs to the faceted picker.
// Presentation only: selecting this derived measure still uses the unchanged v3 profile ID.
for (const profile of descriptor.capabilities.runningSumProfiles ?? []) {
  if (profile.id === 'driver-all-sessions-v1') profile.measureLabel = text('Points after the event', 'Pontos após o evento');
}
for (const field of descriptor.fields) {
  if (field.id === 'driver' || field.id === 'team') field.description = text('Advanced text filters match source IDs. Use the named selections above to search people or teams.', 'O filtro avançado de texto consulta IDs da fonte. Para buscar nomes, use as seleções de pilotos/equipes acima.');
  if (field.id === 'session') field.description = text('Advanced text filters match results/sprint codes. Use the Sessions picker for translated labels.', 'O filtro avançado de texto consulta os códigos results/sprint. Use a seleção Sessões para os rótulos traduzidos.');
}
assertDataset(descriptor);
const abort = (s?: AbortSignal) => { if (s?.aborted) throw new SandboxError('ABORTED', 'Aborted'); };
const cmp = (a: Scalar, b: Scalar) => a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1;
function matches(row: Row, filters: Filter[]) {
  return filters.every(f => {
    const v = row[f.fieldId];
    if (f.op === 'isNull') return v === null;
    if (f.op === 'isNotNull') return v !== null;
    if (v === null) return false;
    if (f.op === 'in') return f.values.includes(v);
    if (f.op === 'contains') return String(v).toLowerCase().includes(f.value.toLowerCase());
    if (f.op !== 'range') return false;
    const compare = (a: Scalar, b: Scalar) => f.fieldId === 'points_raw' ? compareDecimal(String(a), String(b)) : cmp(a, b);
    return (f.min === undefined || compare(v, f.min) >= 0) && (f.max === undefined || compare(v, f.max) <= 0);
  });
}
function sum(values: Scalar[]): string | null {
  if (values.some(v => v === null)) return null;
  const strings = values as string[];
  const scale = strings.reduce((n, v) => Math.max(n, v.split('.')[1]?.length ?? 0), 0);
  const total = strings.reduce((n, v) => { const [whole, frac = ''] = v.replace(/^-/, '').split('.'); return n + (v.startsWith('-') ? -1n : 1n) * BigInt(whole + frac.padEnd(scale, '0')); }, 0n);
  const negative = total < 0n; const digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
}

function aggregateInteger(values: Scalar[], aggregation: 'sum' | 'mean' | 'min' | 'max'): Scalar {
  if (values.some(value => value === null)) return null;
  const numbers = values as number[];
  if (aggregation === 'min' || aggregation === 'max') return numbers.reduce((a, b) => aggregation === 'min' ? Math.min(a, b) : Math.max(a, b));
  const total = numbers.reduce((a, b) => a + BigInt(b), 0n);
  if (aggregation === 'sum') {
    const result = Number(total);
    if (!Number.isSafeInteger(result)) throw new SandboxError('LIMIT_EXCEEDED', 'Integer aggregation exceeds safe range');
    return result;
  }
  const count = BigInt(numbers.length);
  const negative = total < 0n;
  const absolute = negative ? -total : total;
  const scale = 10n ** 12n;
  const numerator = absolute * scale;
  let quotient = numerator / count;
  if (numerator % count * 2n >= count) quotient++;
  const digits = quotient.toString().padStart(13, '0');
  return `${negative && quotient !== 0n ? '-' : ''}${digits.slice(0, -12)}.${digits.slice(-12)}`;
}

function sourceInteger(value: unknown, positiveOnly = false): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw new SandboxError('INVALID_CONTRACT', 'Invalid stored integer result');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (positiveOnly && parsed < 1)) throw new SandboxError('INVALID_CONTRACT', 'Invalid stored integer result');
  return parsed;
}

/** Decimal strings only: never convert points to binary floating point for aggregation. */
function aggregatePoints(values: Scalar[], aggregation: 'sum' | 'mean' | 'min' | 'max'): string | null {
  if (values.some(v => v === null)) return null;
  const numbers = values as string[];
  if (aggregation === 'sum') return sum(values);
  if (aggregation === 'min' || aggregation === 'max') return numbers.reduce((a, b) => (aggregation === 'min' ? compareDecimal(a, b) <= 0 : compareDecimal(a, b) >= 0) ? a : b);
  const total = sum(values)!;
  const [whole, fraction = ''] = total.replace(/^-/, '').split('.');
  const scale = Math.max(12, numbers.reduce((n, v) => Math.max(n, v.split('.')[1]?.length ?? 0), 0));
  const numerator = BigInt(whole + fraction.padEnd(scale, '0'));
  const count = BigInt(numbers.length);
  let quotient = numerator / count;
  if (numerator % count * 2n >= count) quotient += 1n;
  const digits = quotient.toString().padStart(scale + 1, '0');
  const result = `${total.startsWith('-') && quotient !== 0n ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  if (!isScalarOfType(result, 'decimal')) throw new SandboxError('LIMIT_EXCEEDED', 'Mean exceeds decimal precision limit');
  return result;
}

/** The injected reader is the only native boundary; snapshots are held immutable in this instance. */
export function createF1AnalysisProvider(read: SnapshotReader, now: () => number = Date.now, readCatalog?: CatalogReader): SandboxDataProvider {
  type Selection = { selection: ResolvedSelection; catalog: CatalogEntry[]; data?: ReturnType<typeof project> };
  const selections = new Map<string, Selection>();
  const projections = new Map<string, Promise<ReturnType<typeof project>>>();
  function project(snapshots: Snapshot[]) {
      const rows: Row[] = [];
      const chronology = new Map<string, number | null>();
      const integrity = new Map<string, Set<string>>();
      for (const s of snapshots) {
        integrity.set(String(s.year), new Set(s.integrity?.validatedEndpoints ?? []));
      const roundNames = new Map<number, string>();
      for (const event of s.calendar ?? []) {
        if (event.raceName != null && (typeof event.raceName !== 'string' || event.raceName.length > 400)) throw new SandboxError('INVALID_CONTRACT', 'Invalid event name');
        if (event.raceName?.trim()) roundNames.set(Number(event.round), `${Number(event.round)} · ${event.raceName.trim()}`);
        for (const [session, date, time] of [['results', event.date, event.time], ['sprint', event.sprintDate, event.sprintTime]] as const) {
          const key = JSON.stringify([String(s.year), Number(event.round), session]);
          const iso = `${date}T${time}`;
          const valid = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && isScalarOfType(date, 'date') && typeof time === 'string' && /^\d{2}:\d{2}:\d{2}Z$/.test(time) && isScalarOfType(iso, 'datetime');
          if (chronology.has(key)) throw new SandboxError('INVALID_CONTRACT', 'Duplicate calendar round');
          chronology.set(key, valid ? Date.parse(iso) : null);
        }
      }
      for (const item of s.results) {
        const round = Number(item.round); const points = item.result.points ?? null;
        const grid = sourceInteger(item.result.grid);
        const finish = sourceInteger(item.result.position, true);
        const laps = sourceInteger(item.result.laps);
        const gridPosition = grid === 0 ? null : grid;
        const positionBalance = gridPosition === null || finish === null ? null : gridPosition - finish;
        const driver = item.result.Driver?.driverId ?? null; const team = item.result.Constructor?.constructorId ?? null;
        if (!Number.isSafeInteger(s.year) || s.year < 1950 || s.year > 2100 || !/^\d+$/.test(item.round) || !Number.isSafeInteger(round) || round < 1 || !['results', 'sprint'].includes(item.session) || !isScalarOfType(points, 'decimal') || !isScalarOfType(driver, 'string') || !isScalarOfType(team, 'string')) throw new SandboxError('INVALID_CONTRACT', 'Invalid stored occurrence');
        const parts = [item.result.Driver?.givenName, item.result.Driver?.familyName];
        if (parts.some(value => value !== undefined && (typeof value !== 'string' || value.length > 200)) || (item.result.Constructor?.name !== undefined && (typeof item.result.Constructor.name !== 'string' || item.result.Constructor.name.length > 400))) throw new SandboxError('INVALID_CONTRACT', 'Invalid source display name');
        const driverName = parts.filter(Boolean).join(' ').trim();
        const teamName = item.result.Constructor?.name?.trim();
        rows.push({ season: String(s.year), round, round_name: roundNames.get(round) ?? null, session: item.session, driver, driver_name: driverName || driver, team, team_name: teamName || team, points_raw: points, grid_position_raw: gridPosition, finish_position_raw: finish, position_balance_raw: positionBalance, laps_raw: laps, occurrence_raw: 1 });
        if (rows.length > 100_000) throw new SandboxError('LIMIT_EXCEEDED', 'Too many occurrences');
      }
      }
      return { rows, chronology, integrity };
  }

  async function loadCatalog(revisions?: RevisionReference[]) {
    if (readCatalog) return { catalog: await readCatalog(revisions) };
    const snapshots = await read(revisions);
    const catalog = snapshots.map(snapshot => {
      const counts = { results: 0, sprint: 0 };
      for (const result of snapshot.results) {
        if (result.session === 'results' || result.session === 'sprint') counts[result.session]++;
      }
      return { ...snapshotRevision(snapshot), counts, hasTeams: snapshot.results.some(row => row.result.Constructor?.constructorId != null) };
    });
    return { catalog, snapshots };
  }

  function rememberSelection(data: Selection) {
    selections.delete(data.selection.token);
    selections.set(data.selection.token, data);
    if (selections.size > 8) selections.delete(selections.keys().next().value!);
  }

  function selected(selection: ResolvedSelection) {
    assertSelection(selection);
    const data = selections.get(selection.token);
    if (!data || selection.datasetId !== data.selection.datasetId || selection.transformationVersion !== data.selection.transformationVersion
      || revisionKey(selection.revisions) !== revisionKey(data.selection.revisions)) throw new SandboxError('REVISION_MISSING', 'Selection not available in this session');
    rememberSelection(data);
    return data;
  }

  async function selectedRows(selection: Selection, filters: Filter[], signal?: AbortSignal) {
    if (selection.data) return selection.data;
    const seasonFilters = filters.filter(filter => filter.fieldId === 'season');
    const revisions = selection.selection.revisions.filter(revision => matches({ season: revision.partitionId }, seasonFilters));
    if (!revisions.length) return project([]);
    const key = revisionKey(revisions);
    const pending = projections.get(key) ?? read(revisions).then(snapshots => {
      if (revisionKey(snapshots.map(snapshotRevision)) !== key) throw new SandboxError('REVISION_MISSING', 'Revision mismatch');
      return project(snapshots);
    }).catch(error => {
      if (projections.get(key) === pending) projections.delete(key);
      if (error === 'LIMIT_EXCEEDED' || error === 'REVISION_MISSING') throw new SandboxError(error, error);
      throw error;
    });
    projections.delete(key);
    projections.set(key, pending);
    if (projections.size > 2) projections.delete(projections.keys().next().value!);
    const data = await pending;
    abort(signal);
    return data;
  }

  return {
    async listDatasets(signal) {
      abort(signal);
      const { catalog, snapshots } = await loadCatalog();
      if (snapshots) project(snapshots);
      abort(signal);
      return catalog.some(item => item.counts.results || item.counts.sprint) ? [{ id: descriptor.id, label: descriptor.label, description: descriptor.description }] : [];
    },
    async describeDataset({ datasetId }, signal) {
      abort(signal); if (datasetId !== descriptor.id) throw new SandboxError('INVALID_CONTRACT', 'Unknown dataset');
      const { catalog } = await loadCatalog(); abort(signal);
      const result = structuredClone(descriptor);
      const latest = catalog.filter(item => item.counts.results || item.counts.sprint).map(item => item.partitionId).sort().at(-1);
      const visualization = result.presentation!.defaultVisualization!;
      result.presentation!.views = [];
      if (latest) result.presentation!.views.push({ id: 'events', label: text('Event results', 'Resultados dos eventos'), filters: [structuredClone(allSessionFilter)], visualization });
      if (catalog.some(item => item.counts.results)) result.presentation!.views.push({ id: 'race', label: text('Race results', 'Resultados de corrida'), filters: [{ fieldId: 'session', op: 'in', values: ['results'] }], visualization: { ...visualization, unifyEvents: false } });
      if (catalog.some(item => item.counts.sprint)) result.presentation!.views.push({ id: 'sprint', label: text('Sprint results', 'Resultados de sprint'), filters: [{ fieldId: 'session', op: 'in', values: ['sprint'] }], visualization: { ...visualization, unifyEvents: false } });
      if (catalog.some(item => item.hasTeams ?? Boolean(item.counts.results || item.counts.sprint))) result.presentation!.views.push({ id: 'teams', label: text('Points by team', 'Pontuação por equipe'), filters: [structuredClone(allSessionFilter)], visualization: { ...visualization, series: 'team' } });
      result.presentation!.defaultFilters = [...(latest ? [{ fieldId: 'season', op: 'in' as const, values: [latest] }] : []), structuredClone(allSessionFilter)];
      assertDataset(result); return result;
    },
    async resolveSelection(request: SelectionRequest, signal) {
      abort(signal); if (request.protocolVersion !== 1 || request.datasetId !== descriptor.id || !Array.isArray(request.partitionIds) || !['latest', 'pinned'].includes(request.policy)) throw new SandboxError('REVISION_MISSING', 'Selection unavailable');
      let pinnedKey: string | undefined;
      if (request.policy === 'pinned') {
        if (!request.revisions?.length || request.revisions.length > 151 || JSON.stringify([...request.partitionIds].sort()) !== JSON.stringify(request.revisions.map(r => r.partitionId).sort())) throw new SandboxError('REVISION_MISSING', 'Invalid revisions');
        pinnedKey = revisionKey(request.revisions);
        const existing = [...selections.values()].find(s => revisionKey(s.selection.revisions) === pinnedKey);
        if (existing) { rememberSelection(existing); return structuredClone(existing.selection); }
      } else {
        if (request.revisions !== undefined || request.partitionIds.length > 151 || new Set(request.partitionIds).size !== request.partitionIds.length || request.partitionIds.some(id => !/^(19[5-9]\d|20\d\d|2100)$/.test(id))) throw new SandboxError('INVALID_CONTRACT', 'Invalid partitions');
      }
      const { catalog, snapshots } = await loadCatalog(request.revisions);
      abort(signal);
      const scoped = request.policy === 'latest' && request.partitionIds.length ? catalog.filter(item => request.partitionIds.includes(item.partitionId)) : catalog;
      if (request.partitionIds.length && scoped.length !== request.partitionIds.length) throw new SandboxError('REVISION_MISSING', 'Partition unavailable');
      const revisions = scoped.map(({ partitionId, revisionId, sourceDataAt, storedAt }) => ({ partitionId, revisionId, sourceDataAt, storedAt }));
      const key = revisionKey(revisions);
      if (pinnedKey !== undefined && key !== pinnedKey) throw new SandboxError('REVISION_MISSING', 'Revision mismatch');
      const existing = [...selections.values()].find(s => revisionKey(s.selection.revisions) === key);
      const selection: ResolvedSelection = { protocolVersion: 1, datasetId: descriptor.id, token: crypto.randomUUID(), transformationVersion: 'f1-results-1', revisions };
      assertSelection(selection);
      const data = existing ?? { selection, catalog: scoped, data: snapshots && project(snapshots.filter(s => revisions.some(r => r.partitionId === String(s.year)))) };
      rememberSelection(data);
      return structuredClone(data.selection);
    },
    async query(q: QueryRequest, signal) {
      abort(signal); assertQuery(q, descriptor); const groups = new Map<string, Row[]>();
      if (q.unifyEvents) {
        const eventField = descriptor.capabilities.eventUnification!.fieldId;
        const sessionFilters = [...q.filters, ...(q.displayFilters ?? [])].filter(filter => filter.fieldId === eventField);
        const selectedSessions = sessionFilters.length > 0 && sessionFilters.every(filter =>
          filter.op === 'in' && descriptor.capabilities.eventUnification!.requiredValues.every(value => filter.values.includes(value)));
        if (!selectedSessions) throw new SandboxError('INVALID_QUERY', 'Unifying events requires an explicit selection of race and sprint sessions.', eventField);
      }
      if (q.window && q.filters.some(f => f.fieldId === 'team')) throw new SandboxError('INVALID_QUERY', 'Team filters cannot be used for cumulative points; remove the team filter.', 'team');
      const data = await selectedRows(selected(q.selection), q.filters, signal);
      let sourceRows = data.rows;
      if (q.window?.scope === 'profile' && q.window.profileId === 'driver-all-sessions-v1') {
        const synthetic: Row[] = [];
        const partitions = new Map<string, Row[]>();
        const eventsBySeason = new Map<string, Map<string, Row[]>>();
        for (const row of data.rows) {
          const driverKey = JSON.stringify([row.season, row.driver]);
          const driverGroup = partitions.get(driverKey) ?? []; driverGroup.push(row); partitions.set(driverKey, driverGroup);
          const eventKey = JSON.stringify([row.round, row.session]);
          const seasonEvents = eventsBySeason.get(String(row.season)) ?? new Map<string, Row[]>();
          const eventGroup = seasonEvents.get(eventKey) ?? []; eventGroup.push(row); seasonEvents.set(eventKey, eventGroup);
          eventsBySeason.set(String(row.season), seasonEvents);
        }
        for (const [partition, driverRows] of partitions) {
          const [season, driver] = JSON.parse(partition) as [string, string | null];
          if (driver === null || !data.integrity.get(season)?.has('results')) continue;
          const knownSessions = new Set(driverRows.map(row => JSON.stringify([row.round, row.session])));
          const firstKnownTime = driverRows.reduce((earliest, row) => Math.min(earliest, data.chronology.get(JSON.stringify([season, row.round, row.session])) ?? Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
          for (const [eventSession, eventRows] of eventsBySeason.get(season) ?? []) {
            if (knownSessions.has(eventSession)) continue;
            const [round, session] = JSON.parse(eventSession) as [number, string];
            const timestamp = data.chronology.get(JSON.stringify([season, round, session]));
            if (timestamp == null || timestamp > now() || firstKnownTime >= timestamp) continue;
            const hasValidatedSessionData = data.integrity.get(season)?.has(session === 'sprint' ? 'sprint' : 'results');
            if (!hasValidatedSessionData || !eventRows.length) continue;
            synthetic.push({ season, round, round_name: eventRows[0].round_name, session, driver, driver_name: driverRows.find(row => row.driver_name !== null)?.driver_name ?? driver, team: null, team_name: null, points_raw: '0', grid_position_raw: null, finish_position_raw: null, position_balance_raw: null, laps_raw: null, occurrence_raw: 0 });
          }
        }
        sourceRows = [...data.rows, ...synthetic];
      }
      for (const row of sourceRows) if (matches(row, q.filters)) { const key = JSON.stringify(q.dimensions.map(k => row[k])); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
      let output = [...groups.entries()].map(([key, group], index) => {
        const values: Row = Object.fromEntries(q.dimensions.map(k => [k, group[0][k]]));
        for (const id of q.dimensions) { const label = descriptor.fields.find(f => f.id === id)?.labelField; if (label) values[label] = group.find(row => row[label] !== null)?.[label] ?? null; }
        for (const m of q.metrics) {
          const metric = descriptor.metrics.find(item => item.id === m.metricId)!;
          if (m.metricId === 'observations') values[m.metricId] = group.length;
          else if (metric.fieldId === 'points_raw') values[m.metricId] = aggregatePoints(group.map(r => r[metric.fieldId]), m.aggregation as 'sum' | 'mean' | 'min' | 'max');
          else values[m.metricId] = aggregateInteger(group.map(r => r[metric.fieldId]), m.aggregation as 'sum' | 'mean' | 'min' | 'max');
        }
        return { id: String(index), values, key };
      });
      if (q.window) {
        const window = q.window;
        const totals = new Map<string, string | null>();
        const moments = new Map<string, number>();
        if (window.scope === 'profile') {
          for (const row of output) {
            if (row.values.driver === null) throw new SandboxError('ORDER_UNAVAILABLE', 'Missing driver identity');
            const timestamp = data.chronology.get(JSON.stringify([row.values.season, row.values.round, row.values.session]));
            if (timestamp == null || !Number.isFinite(timestamp)) throw new SandboxError('ORDER_UNAVAILABLE', 'Missing session timestamp');
            moments.set(row.key, timestamp);
          }
          output.sort((a, b) => moments.get(a.key)! - moments.get(b.key)!);
        } else output.sort((a, b) => cmp(a.values[window.orderBy], b.values[window.orderBy]));
        const lastMoment = new Map<string, number>();
        for (const row of output) {
          const key = JSON.stringify(window.partitionBy.map(id => row.values[id]));
          if (window.scope === 'profile') {
            const moment = moments.get(row.key)!;
            if (lastMoment.get(key) === moment) throw new SandboxError('ORDER_UNAVAILABLE', 'Ambiguous session order');
            lastMoment.set(key, moment);
          }
          const value = row.values[window.metricId];
          const previous = totals.get(key);
          const next = value === null || previous === null ? null : sum(previous === undefined ? [value] : [previous, value]);
          totals.set(key, next); row.values[window.metricId] = next;
        }
      }
      if (q.unifyEvents && q.dimensions.includes(descriptor.capabilities.eventUnification!.fieldId)) {
        const sessionField = descriptor.capabilities.eventUnification!.fieldId;
        const groupingDimensions = q.dimensions.filter(id => id !== sessionField);
        const eventGroups = new Map<string, typeof output>();
        for (const row of output) {
          const key = JSON.stringify(groupingDimensions.map(id => row.values[id]));
          const group = eventGroups.get(key) ?? []; group.push(row); eventGroups.set(key, group);
        }
        const rawGroups = new Map<string, Row[]>();
        for (const row of sourceRows) {
          if (!matches(row, q.filters)) continue;
          const key = JSON.stringify(groupingDimensions.map(id => row[id]));
          const group = rawGroups.get(key) ?? []; group.push(row); rawGroups.set(key, group);
        }
        output = [...eventGroups.entries()].map(([key, group]) => {
          const chronological = group.map(row => {
            const timestamp = data.chronology.get(JSON.stringify([row.values.season, row.values.round, row.values.session]));
            if (q.window) {
              if (timestamp == null || !Number.isFinite(timestamp)) throw new SandboxError('ORDER_UNAVAILABLE', 'Missing session timestamp');
            }
            return { row, timestamp };
          });
          // Simple aggregations do not need chronology to reaggregate raw source
          // values; use a stable representative session (race preferred).
          chronological.sort((a, b) => q.window
            ? a.timestamp! - b.timestamp!
            : (a.row.values.session === 'results' ? 1 : 0) - (b.row.values.session === 'results' ? 1 : 0));
          const latest = chronological.at(-1)!.row;
          const values = { ...latest.values };
          values[sessionField] = latest.values[sessionField];
          if (!q.window) {
            const rawGroup = rawGroups.get(key) ?? [];
            for (const metric of q.metrics) {
              if (metric.metricId === 'observations') values.observations = rawGroup.length;
              else {
                const definition = descriptor.metrics.find(item => item.id === metric.metricId)!;
                values[metric.metricId] = definition.fieldId === 'points_raw'
                  ? aggregatePoints(rawGroup.map(row => row[definition.fieldId]), metric.aggregation as 'sum' | 'mean' | 'min' | 'max')
                  : aggregateInteger(rawGroup.map(row => row[definition.fieldId]), metric.aggregation as 'sum' | 'mean' | 'min' | 'max');
              }
            }
          }
          if (q.dimensions.includes('round')) {
            const season = String(values.season);
            const round = Number(values.round);
            const raceTimestamp = data.chronology.get(JSON.stringify([season, round, 'results']));
            const hasRaceRows = data.rows.some(row => row.season === season && row.round === round && row.session === 'results');
            const hasRaceInGroup = group.some(row => row.values.session === 'results');
            const raceIsPastOrUnknown = raceTimestamp == null || raceTimestamp <= now();
            if (raceIsPastOrUnknown && !hasRaceRows && q.metrics.some(metric => metric.metricId === 'points')) values.points = null;
            else if (q.window && raceIsPastOrUnknown && !hasRaceInGroup && q.metrics.some(metric => metric.metricId === 'points')) values.points = null;
          }
          return { ...latest, id: key, values, key };
        });
      }
      if (q.displayFilters?.length) output = output.filter(row => matches(row.values, q.displayFilters!));
      if (output.length > q.limit) throw new SandboxError('LIMIT_EXCEEDED', 'Refine filters');
      output.sort((a, b) => { for (const o of q.orderBy) { const metric = q.metrics.find(item => item.metricId === o.fieldId); const decimal = o.fieldId === 'points' || metric?.aggregation === 'mean'; const diff = decimal && a.values[o.fieldId] !== null && b.values[o.fieldId] !== null ? compareDecimal(String(a.values[o.fieldId]), String(b.values[o.fieldId])) : cmp(a.values[o.fieldId], b.values[o.fieldId]); if (diff) return o.direction === 'asc' ? diff : -diff; } return a.key.localeCompare(b.key); });
      const columnIds = [...new Set([...q.dimensions.flatMap(id => [id, ...(descriptor.fields.find(f => f.id === id)?.labelField ? [descriptor.fields.find(f => f.id === id)!.labelField!] : [])]), ...q.metrics.map(m => m.metricId)])];
      const columns = columnIds.map(id => { const f = descriptor.fields.find(x => x.id === id); const m = descriptor.metrics.find(x => x.id === id); const aggregation = q.metrics.find(x => x.metricId === id)?.aggregation; const decimalMean = aggregation === 'mean'; return { id, label: (f ?? m)!.label, type: f?.type ?? (id === 'points' || decimalMean ? 'decimal' as const : 'integer' as const) }; });
      return { protocolVersion: q.protocolVersion, requestId: q.requestId, selectionToken: q.selection.token, columns, rows: output.map(({ id, values }) => ({ id, values })), complete: true, totalRows: output.length, warnings: [
          ...(q.window ? [{ code: 'OBSERVED_ONLY', message: text('Cumulative totals carry forward only for known past-session absences with validated endpoint integrity and results for other drivers. Unknown coverage/null points remain gaps; not official standings.', 'Acumulados são carregados apenas para ausências conhecidas em sessões passadas, com integridade validada do endpoint e resultados de outros pilotos. Cobertura desconhecida/pontos nulos permanecem lacunas; não é classificação oficial.') }] : []),
        ...(q.metrics.some(m => m.metricId === 'points' && m.aggregation === 'mean') ? [{ code: 'MEAN_ROUNDED', message: text('Means are rounded half away from zero to at least 12 decimal places, retaining source precision. Missing points propagate.', 'Médias são arredondadas para longe de zero em empates, com pelo menos 12 casas decimais e preservação da precisão da fonte. Pontos ausentes propagam.') }] : []),
      ] };
    },
    async facet(req: FacetRequest, signal) {
      abort(signal); const field = descriptor.fields.find(f => f.id === req.fieldId);
      if (req.protocolVersion !== 1 || req.datasetId !== descriptor.id || !field?.filters.includes('in') || req.filters.some(f => f.fieldId === req.fieldId) || typeof req.search !== 'string' || req.search.length > 300 || !Number.isInteger(req.limit) || req.limit < 1 || req.limit > 100 || (req.cursor !== undefined && !/^(0|[1-9]\d{0,5})$/.test(req.cursor))) throw new SandboxError('INVALID_QUERY', 'Invalid facet');
      assertQuery({ protocolVersion: 1, requestId: 'facet', datasetId: descriptor.id, schemaVersion: descriptor.schemaVersion, semanticVersion: descriptor.semanticVersion, selection: req.selection, dimensions: ['season'], metrics: [{ metricId: 'points', aggregation: 'sum' }], filters: req.filters, orderBy: [], limit: 1 }, descriptor);
       const selection = selected(req.selection);
       const counts = new Map<string | number | boolean, { labels: Set<string>; count: number }>();
       const scopeFromCatalog = field.id === 'season' && req.filters.every(filter => filter.fieldId === 'session');
       if (scopeFromCatalog) {
         for (const item of selection.catalog) {
           const count = (['results', 'sprint'] as const).reduce((total, session) => total + (matches({ session }, req.filters) ? item.counts[session] : 0), 0);
           if (count) counts.set(item.partitionId, { labels: new Set([item.partitionId]), count });
         }
       }
       const rows = scopeFromCatalog ? [] : (await selectedRows(selection, req.filters, signal)).rows;
       for (const row of rows) {
         const value = row[req.fieldId]; const label = String(field.labelField ? row[field.labelField] ?? value : value);
         if (value !== null && matches(row, req.filters) && (field.id === 'round' || `${label} ${value}`.toLowerCase().includes(req.search.toLowerCase()))) {
           const item = counts.get(value) ?? { labels: new Set<string>(), count: 0 };
           item.labels.add(label); item.count++; counts.set(value, item);
         }
       }
       const all = [...counts].filter(([value, info]) => `${value} ${[...info.labels].join(' ')}`.toLowerCase().includes(req.search.toLowerCase())).sort(([a], [b]) => field.id === 'season' ? cmp(b, a) : cmp(a, b)).map(([value, info]) => ({ value, label: field.id === 'round' && info.labels.size > 1 ? String(value) : [...info.labels].at(-1)!, count: info.count }));
       const labelCounts = new Map<string, number>();
       for (const item of all) labelCounts.set(item.label, (labelCounts.get(item.label) ?? 0) + 1);
       for (const item of all) if (labelCounts.get(item.label)! > 1) item.label = `${item.label} (${item.value})`;
       const start = Number(req.cursor ?? 0); const end = start + req.limit;
      if (start > all.length) throw new SandboxError('INVALID_QUERY', 'Invalid cursor');
      return { values: all.slice(start, end), ...(end < all.length ? { nextCursor: String(end) } : {}) };
    },
  };
}
