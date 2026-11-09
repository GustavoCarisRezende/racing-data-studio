import { assertDataset, assertQuery, assertSelection, compareDecimal, isScalarOfType, SandboxError } from '@rds/sandbox-contracts';
import type { DatasetDescriptor, FacetRequest, Filter, QueryRequest, ResolvedSelection, RevisionReference, SandboxDataProvider, Scalar, SelectionRequest } from '@rds/sandbox-contracts';

type Snapshot = { year: number; id: string; storedAt: string; sourceDataAt: string; results: { round: string; session: string; result: { Driver?: { driverId?: string; givenName?: string; familyName?: string }; Constructor?: { constructorId?: string; name?: string }; points?: string | null } }[] };
type Row = Record<string, Scalar>;
const text = (fallback: string, pt: string) => ({ fallback, translations: { 'pt-BR': pt } });
const dimensions = ['season', 'round', 'session', 'driver', 'team'];
export const descriptor: DatasetDescriptor = {
  protocolVersion: 1, id: 'f1.session_results', schemaVersion: '1', semanticVersion: '1',
  label: text('F1 session results', 'Resultados de sessões F1'),
  description: text('Occurrences reported in locally imported race and sprint snapshots.', 'Ocorrências informadas nos snapshots locais de corridas e sprints.'),
  grain: text('One source result occurrence in a race or sprint.', 'Uma ocorrência de resultado da fonte em corrida ou sprint.'),
  fields: [
    { id: 'season', label: text('Season', 'Temporada'), type: 'string', role: 'dimension', analyticalType: 'ordinal', nullable: false, ordered: true, filters: ['in', 'contains'], availability: 'available' },
    { id: 'round', label: text('Round', 'Rodada'), type: 'integer', role: 'dimension', analyticalType: 'ordinal', nullable: false, ordered: true, filters: ['in', 'range'], availability: 'available' },
    { id: 'session', label: text('Session', 'Sessão'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: false, ordered: false, filters: ['in', 'contains'], availability: 'available', valueLabels: [{ value: 'results', label: text('Race', 'Corrida') }, { value: 'sprint', label: text('Sprint', 'Sprint') }] },
    { id: 'driver', label: text('Driver', 'Piloto'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: true, ordered: false, filters: ['in', 'contains', 'isNull', 'isNotNull'], availability: 'partial', labelField: 'driver_name' },
    { id: 'team', label: text('Team', 'Equipe'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: true, ordered: false, filters: ['in', 'contains', 'isNull', 'isNotNull'], availability: 'partial', labelField: 'team_name' },
    { id: 'driver_name', label: text('Driver name', 'Nome do piloto'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: true, ordered: false, filters: [], availability: 'partial' },
    { id: 'team_name', label: text('Team name', 'Nome da equipe'), type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: true, ordered: false, filters: [], availability: 'partial' },
    { id: 'points_raw', label: text('Reported points', 'Pontos informados'), type: 'decimal', role: 'measure', analyticalType: 'quantitative', nullable: true, ordered: true, filters: ['range', 'isNull', 'isNotNull'], availability: 'partial' },
    { id: 'occurrence_raw', label: text('Occurrence', 'Ocorrência'), type: 'integer', role: 'measure', analyticalType: 'quantitative', nullable: false, ordered: false, filters: [], availability: 'available' },
  ],
  metrics: [
    { id: 'points', label: text('Points', 'Pontos'), description: text('Sum of source result points, not official championship standings.', 'Soma dos pontos dos resultados da fonte; não é classificação oficial.'), fieldId: 'points_raw', aggregations: ['sum'], defaultAggregation: 'sum', groupableBy: dimensions, requiredDimensions: ['season'], nullPolicy: 'propagate', additive: true, supportsRunningSum: false },
    { id: 'observations', label: text('Result occurrences', 'Ocorrências de resultado'), description: text('Number of source result occurrences.', 'Quantidade de ocorrências de resultado da fonte.'), fieldId: 'occurrence_raw', aggregations: ['count'], defaultAggregation: 'count', groupableBy: dimensions, requiredDimensions: ['season'], nullPolicy: 'ignore', additive: false, supportsRunningSum: false },
  ],
  sources: [{ name: 'Jolpica F1', attribution: 'Jolpica F1 API contributors', license: 'CC BY-NC-SA 4.0', url: 'https://github.com/jolpica/jolpica-f1' }],
  limitations: [text('Only imported results; missing events are not zero. Points sums are not official standings. Team IDs do not imply historical continuity. Round does not identify the same circuit across seasons.', 'Somente resultados importados; eventos ausentes não são zero. A soma de pontos não é classificação oficial. IDs de equipe não implicam continuidade histórica. Rodada não identifica o mesmo circuito entre temporadas.'), text('Export and cumulative totals are not available. Saved analyses require their original local snapshots.', 'Exportação e acumulados não estão disponíveis. Análises salvas exigem seus snapshots locais originais.')],
  capabilities: { charts: ['table', 'line', 'bar'], maxDimensions: 3, maxRows: 5000, maxSeries: 100, comparisonDimensions: ['season'], runningSum: false, completeGroupedQueries: true },
  presentation: {
    primaryFilterFieldId: 'season',
    filters: [{ fieldId: 'driver', label: text('Drivers', 'Pilotos') }, { fieldId: 'team', label: text('Teams', 'Equipes') }, { fieldId: 'round', label: text('Rounds', 'Rodadas') }, { fieldId: 'session', label: text('Sessions', 'Sessões') }],
    defaultVisualization: { kind: 'line', x: 'round', metric: { metricId: 'points', aggregation: 'sum' }, series: 'driver', comparison: 'season', runningSum: false },
  },
};
// Preserve legacy literal-ID text filter semantics; name search belongs to the faceted picker.
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

/** The injected reader is the only native boundary; snapshots are held immutable in this instance. */
export function createF1AnalysisProvider(read: (revisions?: RevisionReference[]) => Promise<Snapshot[]>): SandboxDataProvider {
  let frozen: { selection: ResolvedSelection; rows: Row[] } | undefined;
  let pending: Promise<typeof frozen> | undefined;
  const selections = new Map<string, { selection: ResolvedSelection; rows: Row[] }>();
  async function project(snapshots: Snapshot[]) {
      const rows: Row[] = [];
      const revisions = snapshots.map(s => ({ partitionId: String(s.year), revisionId: s.id, sourceDataAt: s.sourceDataAt, storedAt: s.storedAt }));
      const selection: ResolvedSelection = { protocolVersion: 1, datasetId: descriptor.id, token: crypto.randomUUID(), transformationVersion: 'f1-results-1', revisions };
      assertSelection(selection);
      for (const s of snapshots) for (const item of s.results) {
        const round = Number(item.round); const points = item.result.points ?? null;
        const driver = item.result.Driver?.driverId ?? null; const team = item.result.Constructor?.constructorId ?? null;
        if (!Number.isSafeInteger(s.year) || s.year < 1950 || s.year > 2100 || !/^\d+$/.test(item.round) || !Number.isSafeInteger(round) || round < 1 || !['results', 'sprint'].includes(item.session) || !isScalarOfType(points, 'decimal') || !isScalarOfType(driver, 'string') || !isScalarOfType(team, 'string')) throw new SandboxError('INVALID_CONTRACT', 'Invalid stored occurrence');
        const parts = [item.result.Driver?.givenName, item.result.Driver?.familyName];
        if (parts.some(value => value !== undefined && (typeof value !== 'string' || value.length > 200)) || (item.result.Constructor?.name !== undefined && (typeof item.result.Constructor.name !== 'string' || item.result.Constructor.name.length > 400))) throw new SandboxError('INVALID_CONTRACT', 'Invalid source display name');
        const driverName = parts.filter(Boolean).join(' ').trim();
        const teamName = item.result.Constructor?.name?.trim();
        rows.push({ season: String(s.year), round, session: item.session, driver, driver_name: driverName || driver, team, team_name: teamName || team, points_raw: points, occurrence_raw: 1 });
        if (rows.length > 100_000) throw new SandboxError('LIMIT_EXCEEDED', 'Too many occurrences');
      }
      return { selection, rows };
  }
  async function load() {
    if (!pending) pending = (async () => {
      frozen = await project(await read()); selections.set(frozen.selection.token, frozen); return frozen;
    })().catch(e => { pending = undefined; throw e; });
    return (await pending)!;
  }
  function selected(selection: ResolvedSelection) {
    assertSelection(selection);
    const data = selections.get(selection.token);
    if (!data || JSON.stringify(selection) !== JSON.stringify(data.selection)) throw new SandboxError('REVISION_MISSING', 'Selection not available in this session');
    return data.rows;
  }
  return {
    async listDatasets(signal) { abort(signal); const data = await load(); abort(signal); return data.rows.length ? [{ id: descriptor.id, label: descriptor.label, description: descriptor.description }] : []; },
    async describeDataset({ datasetId }, signal) {
      abort(signal); if (datasetId !== descriptor.id) throw new SandboxError('INVALID_CONTRACT', 'Unknown dataset');
      const data = await load(); abort(signal);
      const result = structuredClone(descriptor);
      const latest = [...new Set(data.rows.map(row => String(row.season)))].sort().at(-1);
      const sessions = new Set(data.rows.map(row => row.session));
      const visualization = result.presentation!.defaultVisualization!;
      result.presentation!.views = [];
      if (sessions.has('results')) result.presentation!.views.push({ id: 'race', label: text('Race results', 'Resultados de corrida'), filters: [{ fieldId: 'session', op: 'in', values: ['results'] }], visualization });
      if (sessions.has('sprint')) result.presentation!.views.push({ id: 'sprint', label: text('Sprint results', 'Resultados de sprint'), filters: [{ fieldId: 'session', op: 'in', values: ['sprint'] }], visualization });
      if (data.rows.some(row => row.team !== null)) result.presentation!.views.push({ id: 'teams', label: text('Points by team', 'Pontuação por equipe'), filters: sessions.has('results') ? [{ fieldId: 'session', op: 'in', values: ['results'] }] : [], visualization: { ...visualization, series: 'team' } });
      result.presentation!.defaultFilters = [...(latest ? [{ fieldId: 'season', op: 'in' as const, values: [latest] }] : []), ...(result.presentation!.views[0]?.filters ?? [])];
      assertDataset(result); return result;
    },
    async resolveSelection(request: SelectionRequest, signal) {
      abort(signal); if (request.protocolVersion !== 1 || request.datasetId !== descriptor.id || !Array.isArray(request.partitionIds) || !['latest', 'pinned'].includes(request.policy)) throw new SandboxError('REVISION_MISSING', 'Selection unavailable');
      let data = await load(); abort(signal);
      if (request.policy === 'pinned') {
        if (!request.revisions?.length || request.revisions.length > 151 || JSON.stringify([...request.partitionIds].sort()) !== JSON.stringify(request.revisions.map(r => r.partitionId).sort())) throw new SandboxError('REVISION_MISSING', 'Invalid revisions');
        data = [...selections.values()].find(s => JSON.stringify(s.selection.revisions) === JSON.stringify(request.revisions)) ?? await project(await read(request.revisions));
        abort(signal);
        if (JSON.stringify(data.selection.revisions) !== JSON.stringify(request.revisions)) throw new SandboxError('REVISION_MISSING', 'Revision mismatch');
        if (!selections.has(data.selection.token) && selections.size >= 8) throw new SandboxError('LIMIT_EXCEEDED', 'Too many open revisions');
        selections.set(data.selection.token, data);
      } else if (request.partitionIds.length && JSON.stringify([...request.partitionIds].sort()) !== JSON.stringify(data.selection.revisions.map(r => r.partitionId).sort())) throw new SandboxError('REVISION_MISSING', 'Selection unavailable');
      return structuredClone(data.selection);
    },
    async query(q: QueryRequest, signal) {
      abort(signal); assertQuery(q, descriptor); const groups = new Map<string, Row[]>();
      for (const row of selected(q.selection)) if (matches(row, q.filters)) { const key = JSON.stringify(q.dimensions.map(k => row[k])); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
      if (groups.size > q.limit) throw new SandboxError('LIMIT_EXCEEDED', 'Refine filters');
      const output = [...groups.entries()].map(([key, group], index) => {
        const values: Row = Object.fromEntries(q.dimensions.map(k => [k, group[0][k]]));
        for (const id of q.dimensions) { const label = descriptor.fields.find(f => f.id === id)?.labelField; if (label) values[label] = group.find(row => row[label] !== null)?.[label] ?? null; }
        for (const m of q.metrics) values[m.metricId] = m.metricId === 'points' ? sum(group.map(r => r.points_raw)) : group.length;
        return { id: String(index), values, key };
      });
      output.sort((a, b) => { for (const o of q.orderBy) { const diff = o.fieldId === 'points' && a.values.points !== null && b.values.points !== null ? compareDecimal(String(a.values.points), String(b.values.points)) : cmp(a.values[o.fieldId], b.values[o.fieldId]); if (diff) return o.direction === 'asc' ? diff : -diff; } return a.key.localeCompare(b.key); });
      const columnIds = [...new Set([...q.dimensions.flatMap(id => [id, ...(descriptor.fields.find(f => f.id === id)?.labelField ? [descriptor.fields.find(f => f.id === id)!.labelField!] : [])]), ...q.metrics.map(m => m.metricId)])];
      const columns = columnIds.map(id => { const f = descriptor.fields.find(x => x.id === id); const m = descriptor.metrics.find(x => x.id === id); return { id, label: (f ?? m)!.label, type: f?.type ?? (id === 'points' ? 'decimal' as const : 'integer' as const) }; });
      return { protocolVersion: 1, requestId: q.requestId, selectionToken: q.selection.token, columns, rows: output.map(({ id, values }) => ({ id, values })), complete: true, totalRows: output.length, warnings: [] };
    },
    async facet(req: FacetRequest, signal) {
      abort(signal); const field = descriptor.fields.find(f => f.id === req.fieldId);
      if (req.protocolVersion !== 1 || req.datasetId !== descriptor.id || !field?.filters.includes('in') || req.filters.some(f => f.fieldId === req.fieldId) || typeof req.search !== 'string' || req.search.length > 300 || !Number.isInteger(req.limit) || req.limit < 1 || req.limit > 100 || (req.cursor !== undefined && !/^(0|[1-9]\d{0,5})$/.test(req.cursor))) throw new SandboxError('INVALID_QUERY', 'Invalid facet');
      assertQuery({ protocolVersion: 1, requestId: 'facet', datasetId: descriptor.id, schemaVersion: descriptor.schemaVersion, semanticVersion: descriptor.semanticVersion, selection: req.selection, dimensions: ['season'], metrics: [{ metricId: 'points', aggregation: 'sum' }], filters: req.filters, orderBy: [], limit: 1 }, descriptor);
       const counts = new Map<string | number | boolean, { label: string; count: number }>();
       for (const row of selected(req.selection)) {
         const value = row[req.fieldId]; const label = String(field.labelField ? row[field.labelField] ?? value : value);
         if (value !== null && matches(row, req.filters) && `${label} ${value}`.toLowerCase().includes(req.search.toLowerCase())) counts.set(value, { label, count: (counts.get(value)?.count ?? 0) + 1 });
       }
       const all = [...counts].sort(([a], [b]) => field.id === 'season' ? cmp(b, a) : cmp(a, b)).map(([value, info]) => ({ value, ...info }));
       const labelCounts = new Map<string, number>();
       for (const item of all) labelCounts.set(item.label, (labelCounts.get(item.label) ?? 0) + 1);
       for (const item of all) if (labelCounts.get(item.label)! > 1) item.label = `${item.label} (${item.value})`;
       const start = Number(req.cursor ?? 0); const end = start + req.limit;
      if (start > all.length) throw new SandboxError('INVALID_QUERY', 'Invalid cursor');
      return { values: all.slice(start, end), ...(end < all.length ? { nextCursor: String(end) } : {}) };
    },
  };
}
