import type { DatasetDescriptor, VisualizationSpec } from '@rds/sandbox-contracts';
import { availableDimensions, localize } from '@rds/sandbox-core';
import type { Translate } from './messages.js';

/** Both presentations edit the same visualization state, never independent defaults. */
export function Bindings({ descriptor: d, value: v, onChange, locale, t, disabled, compact = false }: {
  descriptor: DatasetDescriptor; value: VisualizationSpec; onChange: (patch: Partial<VisualizationSpec>) => void;
  locale: string; t: Translate; disabled: boolean; compact?: boolean;
}) {
  const dimensions = availableDimensions(d);
  const metric = d.metrics.find(m => m.id === v.metric.metricId)!;
  const seriesRequired = Boolean(v.series && metric.requiredDimensions?.includes(v.series));
  return <div className={compact ? 'rds-sb-bindings rds-sb-bindings-inline' : 'rds-sb-bindings'}>
    <label>{t('x')}<select disabled={disabled} value={v.x} onChange={e => onChange({ x: e.target.value })}>{dimensions.filter(f => metric.groupableBy.includes(f.id)).map(f => <option key={f.id} value={f.id}>{localize(f.label, locale)}</option>)}</select></label>
    <label>{t('metric')}<select disabled={disabled} value={metric.id} onChange={e => { const m = d.metrics.find(x => x.id === e.target.value)!; onChange({ metric: { metricId: m.id, aggregation: m.defaultAggregation } }); }}>{d.metrics.filter(m => d.fields.find(f => f.id === m.fieldId)?.availability !== 'unavailable' && dimensions.some(f => m.groupableBy.includes(f.id))).map(m => <option key={m.id} value={m.id}>{localize(m.label, locale)}</option>)}</select></label>
    {d.capabilities.maxDimensions >= 2 && <label>{t('series')}<select disabled={disabled || seriesRequired || (v.series === null && Boolean(v.comparison && metric.requiredDimensions?.includes(v.comparison)) && d.capabilities.maxDimensions < 3)} value={v.series ?? ''} onChange={e => onChange({ series: e.target.value || null, ...(d.capabilities.maxDimensions < 3 ? { comparison: null } : {}) })}><option value="">{t('none')}</option>{dimensions.filter(f => f.id !== v.x && f.id !== v.comparison && metric.groupableBy.includes(f.id)).map(f => <option key={f.id} value={f.id}>{localize(f.label, locale)}</option>)}</select></label>}
  </div>;
}
