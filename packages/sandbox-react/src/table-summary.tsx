import type { DatasetDescriptor, VisualizationSpec } from '@rds/sandbox-contracts';
import { availableDimensions, localize, summarizeTableBy, visualizationDimensions } from '@rds/sandbox-core';
import type { Translate } from './messages.js';

/** Explicitly changes query grain and recalculates via the provider, not tableRows. */
export function TableSummary({ descriptor, value, onApply, locale, t, disabled }: { descriptor: DatasetDescriptor; value: VisualizationSpec; onApply: (value: VisualizationSpec) => void; locale: string; t: Translate; disabled: boolean }) {
  const choices = availableDimensions(descriptor).filter(field => summarizeTableBy(descriptor, value, field.id));
  return <details className="rds-sb-config-section" open>
    <summary>{t('summaryTitle')}</summary>
    <p className="rds-sb-muted">{t('summaryHelp')}</p>
    <p className="rds-sb-muted">{t('summaryCurrent')}: {visualizationDimensions(value).map(id => localize(descriptor.fields.find(field => field.id === id)!.label, locale)).join(' · ')}</p>
    {choices.length === 0 && <p role="note">{t('summaryUnavailable')}</p>}
    <label>{t('summaryBy')}<select disabled={disabled || choices.length === 0} value="" onChange={e => { const next = summarizeTableBy(descriptor, value, e.target.value); if (next) onApply(next); }}><option value="">{t('summaryChoose')}</option>{choices.map(field => <option key={field.id} value={field.id}>{localize(field.label, locale)}</option>)}</select></label>
  </details>;
}
