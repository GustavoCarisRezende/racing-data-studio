import type { DatasetDescriptor, TableConfiguration, VisualizationSpec } from '@rds/sandbox-contracts';
import { localize, visualizationDimensions } from '@rds/sandbox-core';
import type { Translate } from './messages.js';

export function TableColumns({ descriptor: d, value: v, onChange, locale, t, disabled }: { descriptor: DatasetDescriptor; value: VisualizationSpec; onChange: (table: TableConfiguration) => void; locale: string; t: Translate; disabled: boolean }) {
  const ids = [...visualizationDimensions(v), v.metric.metricId, ...(v.kind === 'scatter' && v.secondaryMetric ? [v.secondaryMetric.metricId] : [])];
  const selected = v.table?.columns ?? ids;
  const order = [...selected, ...ids.filter(id => !selected.includes(id))];
  const derived = d.capabilities.runningSumProfiles?.find(p => p.id === v.calculation?.profileId);
  const label = (id: string) => localize(derived?.metricId === id ? derived.measureLabel ?? derived.label : (d.fields.find(f => f.id === id) ?? d.metrics.find(m => m.id === id))!.label, locale);
  const change = (columns: string[]) => onChange({ version: 1, columns, ...(v.table?.sort ? { sort: v.table.sort } : {}) });
  const move = (id: string, delta: number) => {
    const columns = [...selected]; const i = columns.indexOf(id); const j = i + delta;
    if (i < 0 || j < 0 || j >= columns.length) return;
    [columns[i], columns[j]] = [columns[j]!, columns[i]!]; change(columns);
  };
  return <details className="rds-sb-config-section">
    <summary>{t('columns')}</summary>
    <fieldset disabled={disabled} className="rds-sb-column-editor">
      <legend className="rds-sb-sr">{t('columns')}</legend>
      {order.map(id => <div key={id} onKeyDown={e => {
        if (!disabled && e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); move(id, e.key === 'ArrowUp' ? -1 : 1); }
      }}>
        <label><input type="checkbox" checked={selected.includes(id)} disabled={selected.length === 1 && selected.includes(id)} onChange={e => change(e.target.checked ? [...selected, id] : selected.filter(key => key !== id))} />{label(id)}</label>
        <button type="button" aria-label={`${t('up')}: ${label(id)}`} disabled={selected.indexOf(id) <= 0} onClick={() => move(id, -1)}>↑</button>
        <button type="button" aria-label={`${t('down')}: ${label(id)}`} disabled={!selected.includes(id) || selected.indexOf(id) === selected.length - 1} onClick={() => move(id, 1)}>↓</button>
      </div>)}
    </fieldset>
    <label>{t('sort')}<select disabled={disabled} value={v.table?.sort?.columnId ?? ''} onChange={e => onChange({ version: 1, columns: selected, ...(e.target.value ? { sort: { columnId: e.target.value, direction: v.table?.sort?.direction ?? 'asc' } } : {}) })}>
      <option value="">{t('none')}</option>{ids.map(id => <option key={id} value={id}>{label(id)}</option>)}
    </select></label>
    {v.table?.sort && <label>{t('direction')}<select disabled={disabled} value={v.table.sort.direction} onChange={e => onChange({ ...v.table!, sort: { ...v.table!.sort!, direction: e.target.value as 'asc' | 'desc' } })}>
      <option value="asc">{t('asc')}</option><option value="desc">{t('desc')}</option>
    </select></label>}
  </details>;
}
