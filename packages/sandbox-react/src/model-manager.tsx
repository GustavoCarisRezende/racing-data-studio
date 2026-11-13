import type { ReactNode } from 'react';
import type { AnalysisSummary } from '@rds/sandbox-contracts';
import { Icon } from './icons.js';
import type { Translate } from './messages.js';

/** Persisted defaults and user models are the SAME collection. No generated fallback records. */
export function ModelManager({ t, items, selected, onSelect, onOpen, onDelete, onRefresh, onRestoreDefaults, onNew, onRename, onCopy, disabled, loading, error, activeTitle, views, legacy }: {
  t: Translate; items: AnalysisSummary[]; selected: string; onSelect: (id: string) => void;
  onOpen: () => void; onDelete: () => void; onRefresh: () => void; onRestoreDefaults?: () => void;
  onNew: () => void; onRename: () => void; onCopy?: () => void; disabled: boolean;
  loading: boolean; error: string; activeTitle?: string; views?: ReactNode; legacy?: ReactNode;
}) {
  return <section className="rds-sb-models" aria-label={t('models')}>
    <h3><Icon name="models" />{t('models')}</h3>
    {loading && <p role="status">{t('loading')}</p>}
    {error && <p role="alert">{error}</p>}
    {items.length > 0 ? <>
      <label><span className="rds-sb-sr">{t('models')}</span><select disabled={disabled || loading} value={selected} onChange={e => onSelect(e.target.value)}><option value="">{t('chooseModel')}</option>{items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <div className="rds-sb-model-actions"><button type="button" disabled={disabled || !selected} onClick={onOpen}>{t('open')}</button><button type="button" disabled={disabled || !selected} onClick={onDelete}>{t('deleteModel')}</button></div>
    </> : !loading && <p className="rds-sb-muted">{t('noModels')}</p>}
    {activeTitle && <p className="rds-sb-model-active">{t('editingModel')}: <strong>{activeTitle}</strong></p>}
    <div className="rds-sb-model-actions"><button type="button" disabled={disabled} onClick={onNew}>{t('createVisualization')}</button><button type="button" disabled={disabled} onClick={onRename}>{t('rename')}</button>{onCopy && <button type="button" disabled={disabled} onClick={onCopy}>{t('newModel')}</button>}</div>
    <details className="rds-sb-model-tools"><summary>{t('manageModels')}</summary>
      <p className="rds-sb-muted">{t('modelManagementHelp')}</p>
      <button type="button" disabled={disabled || loading} onClick={onRefresh}>{t('refreshModels')}</button>
      {onRestoreDefaults && <button type="button" disabled={disabled || loading} onClick={onRestoreDefaults}>{t('restoreDefaults')}</button>}
    </details>
    {views && <details className="rds-sb-views" open={!loading && items.length === 0}><summary>{t('datasetViews')}</summary>{views}</details>}
    {legacy}
  </section>;
}
