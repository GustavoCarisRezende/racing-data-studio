import { useEffect, useState } from 'react';
import { isScalarOfType } from '@rds/sandbox-contracts';
import type { PieConfiguration } from '@rds/sandbox-contracts';
import type { Translate } from './messages.js';

const defaults: PieConfiguration = { version: 1, order: 'source', showLegend: true, showLabels: true };

export function PieOptions({ value, onChange, disabled, t }: { value?: PieConfiguration; onChange: (value: PieConfiguration) => void; disabled: boolean; t: Translate }) {
  const pie = value ?? defaults;
  const [draft, setDraft] = useState(pie.otherBelow ?? '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(value?.otherBelow ?? ''); setInvalid(false); }, [value?.otherBelow]);
  const commit = () => {
    const text = draft.trim();
    if (text && (!isScalarOfType(text, 'decimal') || text.startsWith('-'))) { setDraft(pie.otherBelow ?? ''); setInvalid(true); return; }
    setInvalid(false);
    if (text === (pie.otherBelow ?? '')) return;
    const next = { ...pie };
    if (text) next.otherBelow = text; else delete next.otherBelow;
    onChange(next);
  };
  return <details className="rds-sb-config-section" open>
    <summary>{t('pieOptions')}</summary>
    <label>{t('pieOrder')}<select disabled={disabled} value={pie.order} onChange={e => onChange({ ...pie, order: e.target.value as PieConfiguration['order'] })}><option value="source">{t('pieSource')}</option><option value="asc">{t('asc')}</option><option value="desc">{t('desc')}</option></select></label>
    <label>{t('pieBelow')}<input type="text" inputMode="decimal" maxLength={100} disabled={disabled} value={draft} aria-invalid={invalid} onChange={e => { setDraft(e.target.value); setInvalid(false); }} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
    {invalid && <p role="alert">{t('pieThresholdInvalid')}</p>}
    <p className="rds-sb-muted">{t('pieOtherHelp')}</p>
    <label className="rds-sb-check"><input type="checkbox" disabled={disabled} checked={pie.showLegend} onChange={e => onChange({ ...pie, showLegend: e.target.checked })} />{t('pieLegend')}</label>
    <label className="rds-sb-check"><input type="checkbox" disabled={disabled} checked={pie.showLabels} onChange={e => onChange({ ...pie, showLabels: e.target.checked })} />{t('pieLabels')}</label>
  </details>;
}
