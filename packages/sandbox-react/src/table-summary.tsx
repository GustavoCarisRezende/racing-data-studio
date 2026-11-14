import { useState } from 'react';
import type { DatasetDescriptor, VisualizationSpec } from '@rds/sandbox-contracts';
import { availableDimensions, editableKey, localize, summarizeTableBy, visualizationDimensions } from '@rds/sandbox-core';
import type { Translate } from './messages.js';

/** Explicitly changes query grain and recalculates via the provider, not tableRows. */
export function TableSummary({ descriptor, value, onApply, locale, t, disabled }: { descriptor: DatasetDescriptor; value: VisualizationSpec; onApply: (value: VisualizationSpec) => void; locale: string; t: Translate; disabled: boolean }) {
  const [selected, setSelected] = useState('');
  const choices = availableDimensions(descriptor).filter(field => summarizeTableBy(descriptor, value, field.id));
  const next = selected && choices.some(field => field.id === selected) ? summarizeTableBy(descriptor, value, selected) : null;
  const changed = Boolean(next && editableKey(descriptor.id, '', next, []) !== editableKey(descriptor.id, '', value, []));
  return <details className="rds-sb-config-section" open>
    <summary>{t('summaryTitle')}</summary>
    <p className="rds-sb-muted">{t('summaryHelp')}</p>
    <p className="rds-sb-muted">{t('summaryCurrent')}: {visualizationDimensions(value).map(id => localize(descriptor.fields.find(field => field.id === id)!.label, locale)).join(' · ')}</p>
    <label>{t('summaryBy')}<select disabled={disabled} value={next ? selected : ''} onChange={e => setSelected(e.target.value)}><option value="">{t('summaryChoose')}</option>{choices.map(field => <option key={field.id} value={field.id}>{localize(field.label, locale)}</option>)}</select></label>
    {next && <p className="rds-sb-muted">{t('summaryGrain')}: {visualizationDimensions(next).map(id => localize(descriptor.fields.find(field => field.id === id)!.label, locale)).join(' · ')}</p>}
    <button type="button" disabled={disabled || !next || !changed} onClick={() => { if (next && changed) onApply(next); }}>{t('summaryApply')}</button>
  </details>;
}
