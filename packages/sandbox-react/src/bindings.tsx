import type { DatasetDescriptor, VisualizationSpec } from '@rds/sandbox-contracts';
import { availableDimensions, compatibleScatterMetrics, localize, visualizationDimensions } from '@rds/sandbox-core';
import type { Translate } from './messages.js';

/** Single configuration surface, on the right. */
export function Bindings({ descriptor: d, value: v, onChange, onProfileChange, locale, t, disabled, compact = false }: {
  descriptor: DatasetDescriptor; value: VisualizationSpec; onChange: (patch: Partial<VisualizationSpec>) => void;
  onProfileChange: (id: string) => void;
  locale: string; t: Translate; disabled: boolean; compact?: boolean;
}) {
  const dimensions = availableDimensions(d);
  const metric = d.metrics.find(m => m.id === v.metric.metricId)!;
  const second = v.kind === 'scatter' ? d.metrics.find(m => m.id === v.secondaryMetric?.metricId) : undefined;
  const seriesRequired = Boolean(v.series && (metric.requiredDimensions?.includes(v.series) || second?.requiredDimensions?.includes(v.series) || d.capabilities.multiSelection?.fieldId === v.series));
  const compatible = (id: string) => metric.groupableBy.includes(id) && (!second || second.groupableBy.includes(id));
  const profile = d.capabilities.runningSumProfiles?.find(p => p.id === v.calculation?.profileId);
  const alternatives = profile?.groupingFamily ? d.capabilities.runningSumProfiles?.filter(p => p.groupingFamily === profile.groupingFamily && p.groupingField) ?? [] : [];
  const visibleProfiles = d.capabilities.runningSumProfiles?.filter((p, index, all) => !p.groupingFamily || all.findIndex(other => other.groupingFamily === p.groupingFamily) === index);
  return <div className={compact ? 'rds-sb-bindings rds-sb-bindings-inline' : 'rds-sb-bindings'}>
    <label>{t(v.kind === 'scatter' ? 'observation' : v.kind === 'pie' ? 'category' : 'x')}<select disabled={disabled || Boolean(v.calculation)} value={v.x} onChange={e => onChange({ x: e.target.value })}>{dimensions.filter(f => compatible(f.id)).map(f => <option key={f.id} value={f.id}>{localize(f.label, locale)}</option>)}</select></label>
    <label>{t(v.kind === 'scatter' ? 'yMetric' : 'metric')}<select disabled={disabled} value={v.calculation ? `@calc:${v.calculation.profileId}` : metric.id} onChange={e => {
      if (e.target.value.startsWith('@calc:')) { onProfileChange(e.target.value.slice(6)); return; }
      const m = d.metrics.find(x => x.id === e.target.value)!;
      onChange({ metric: { metricId: m.id, aggregation: m.defaultAggregation }, ...(v.calculation ? { calculation: undefined, extraDimensions: undefined, runningSum: false } : {}) });
    }}>{d.metrics.filter(m => d.fields.find(f => f.id === m.fieldId)?.availability !== 'unavailable' && dimensions.some(f => m.groupableBy.includes(f.id))).map(m => <option key={m.id} value={m.id}>{localize(m.label, locale)}</option>)}{visibleProfiles?.map(p => <option key={`@calc:${p.id}`} value={`@calc:${p.id}`}>{localize(p.measureLabel ?? p.label, locale)}</option>)}{profile && !visibleProfiles?.some(p => p.id === profile.id) && <option value={`@calc:${profile.id}`} hidden>{localize(profile.measureLabel ?? profile.label, locale)}</option>}</select></label>
    {v.kind === 'scatter' && second && <><label>{t('secondaryMetric')}<select disabled={disabled} value={second.id} onChange={e => { const m = d.metrics.find(m => m.id === e.target.value)!; onChange({ secondaryMetric: { metricId: m.id, aggregation: m.defaultAggregation } }); }}>{compatibleScatterMetrics(d, v).map(m => <option key={m.id} value={m.id}>{localize(m.label, locale)}</option>)}</select></label><label>{t('secondaryMetric')} · {t('aggregation')}<select disabled={disabled} value={v.secondaryMetric!.aggregation} onChange={e => onChange({ secondaryMetric: { ...v.secondaryMetric!, aggregation: e.target.value as typeof v.metric.aggregation } })}>{second.aggregations.map(a => <option key={a} value={a}>{t(a)}</option>)}</select></label></>}
    {alternatives.length > 1 ? <label>{t('series')}<select disabled={disabled} value={profile?.id} onChange={e => onProfileChange(e.target.value)}>{alternatives.map(p => <option key={p.id} value={p.id}>{localize(d.fields.find(f => f.id === p.groupingField)!.label, locale)}</option>)}</select></label> : d.capabilities.maxDimensions >= 2 && <label>{t('series')}<select disabled={disabled || Boolean(v.calculation) || seriesRequired || (v.series === null && Boolean(v.comparison && metric.requiredDimensions?.includes(v.comparison)) && d.capabilities.maxDimensions < 3)} value={v.series ?? ''} onChange={e => onChange({ series: e.target.value || null, ...(d.capabilities.maxDimensions < 3 ? { comparison: null } : {}) })}><option value="">{t('none')}</option>{dimensions.filter(f => f.id !== v.x && f.id !== v.comparison && compatible(f.id)).map(f => <option key={f.id} value={f.id}>{localize(f.label, locale)}</option>)}</select></label>}
    {d.capabilities.queryVersions?.includes(3) && <details className="rds-sb-extra-fields"><summary>{t('extraDimensions')}</summary><fieldset disabled={disabled || Boolean(v.calculation)}><legend className="rds-sb-sr">{t('extraDimensions')}</legend>{dimensions.filter(f => ![v.x, v.series, v.comparison].includes(f.id) && compatible(f.id)).map(f => <label className="rds-sb-check" key={f.id}><input type="checkbox" checked={v.extraDimensions?.includes(f.id) ?? false} disabled={!v.extraDimensions?.includes(f.id) && visualizationDimensions(v).length >= d.capabilities.maxDimensions} onChange={e => onChange({ extraDimensions: e.target.checked ? [...v.extraDimensions ?? [], f.id] : v.extraDimensions?.filter(id => id !== f.id) ?? [] })} />{localize(f.label, locale)}</label>)}</fieldset></details>}
  </div>;
}
