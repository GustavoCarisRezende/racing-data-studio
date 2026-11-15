import type { DatasetDescriptor, TableConfiguration, VisualizationSpec } from '@rds/sandbox-contracts';
import { localize, visualizationDimensions } from '@rds/sandbox-core';
import type { Translate } from './messages.js';

export function TableColumns({ descriptor: d, value: v, onChange, locale, t, disabled }: { descriptor: DatasetDescriptor; value: VisualizationSpec; onChange: (table: TableConfiguration) => void; locale: string; t: Translate; disabled: boolean }) {
  const ids = [...visualizationDimensions(v), v.metric.metricId, ...(v.kind === 'scatter' && v.secondaryMetric ? [v.secondaryMetric.metricId] : [])];
  const selected = v.table?.columns ?? ids;
  const order = [...selected, ...ids.filter(id => !selected.includes(id))];
  const derived = d.capabilities.runningSumProfiles?.find(p => p.id === v.calculation?.profileId);
  const label = (id: string) => localize(derived?.metricId === id ? derived.measureLabel ?? derived.label : (d.fields.find(f => f.id === id) ?? d.metrics.find(m => m.id === id))!.label, locale);
  const sorts = v.table?.version === 2 ? v.table.sorts : v.table?.sort ? [v.table.sort] : [];
  const change = (columns: string[]) => onChange(v.table?.version === 2 ? { ...v.table, columns, ...(v.table.groupBy && !columns.includes(v.table.groupBy) ? { groupBy: undefined } : {}) } : { version: 1, columns, ...(v.table?.sort ? { sort: v.table.sort } : {}) });
  const move = (id: string, delta: number) => {
    const columns = [...selected]; const i = columns.indexOf(id); const j = i + delta;
    if (i < 0 || j < 0 || j >= columns.length) return;
    [columns[i], columns[j]] = [columns[j]!, columns[i]!]; change(columns);
  };
  return <details className="rds-sb-config-section">
    <summary>{t('columns')}</summary>
    <fieldset disabled={disabled} className="rds-sb-column-editor">
      <legend className="rds-sb-sr">{t('columns')}</legend>
      {order.map(id => <div key={id} draggable={!disabled && selected.includes(id)} onDragStart={e => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; }} onDragOver={e => { if (!disabled && selected.includes(id)) e.preventDefault(); }} onDrop={e => {
        e.preventDefault();
        const source = e.dataTransfer.getData('text/plain');
        const from = selected.indexOf(source); const to = selected.indexOf(id);
        if (disabled || from < 0 || to < 0 || from === to) return;
        const columns = [...selected]; columns.splice(from, 1); columns.splice(to, 0, source); change(columns);
      }} onKeyDown={e => {
        if (!disabled && e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); move(id, e.key === 'ArrowUp' ? -1 : 1); }
      }}>
        <label><input type="checkbox" checked={selected.includes(id)} disabled={selected.length === 1 && selected.includes(id)} onChange={e => change(e.target.checked ? [...selected, id] : selected.filter(key => key !== id))} />{label(id)}</label>
        <button type="button" aria-label={`${t('up')}: ${label(id)}`} disabled={selected.indexOf(id) <= 0} onClick={() => move(id, -1)}>↑</button>
        <button type="button" aria-label={`${t('down')}: ${label(id)}`} disabled={!selected.includes(id) || selected.indexOf(id) === selected.length - 1} onClick={() => move(id, 1)}>↓</button>
      </div>)}
    </fieldset>
    <label>{t('sort')}<select disabled={disabled} value={sorts[0]?.columnId ?? ''} onChange={e => {
      const next = e.target.value ? [{ columnId: e.target.value, direction: sorts[0]?.direction ?? 'asc' as const }, ...sorts.slice(1).filter(s => s.columnId !== e.target.value)] : sorts.slice(1);
      onChange(v.table?.version === 2 ? { ...v.table, sorts: next } : { version: 1, columns: selected, ...(next[0] ? { sort: next[0] } : {}) });
    }}>
      <option value="">{t('none')}</option>{ids.map(id => <option key={id} value={id}>{label(id)}</option>)}
    </select></label>
    {sorts[0] && <label>{t('direction')}<select disabled={disabled} value={sorts[0].direction} onChange={e => {
      const direction = e.target.value as 'asc' | 'desc';
      onChange(v.table?.version === 2 ? { ...v.table, sorts: [{ ...sorts[0]!, direction }, ...sorts.slice(1)] } : { version: 1, columns: selected, sort: { ...sorts[0]!, direction } });
    }}>
      <option value="asc">{t('asc')}</option><option value="desc">{t('desc')}</option>
    </select></label>}
    {v.table?.version === 2 && v.table.groupBy && <p className="rds-sb-muted">{t('tableGroupHelp')}</p>}
  </details>;
}
