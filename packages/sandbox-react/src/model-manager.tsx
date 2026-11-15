import type { ReactNode } from 'react';
import type { AnalysisSummary } from '@rds/sandbox-contracts';
import { Icon } from './icons.js';
import type { Translate } from './messages.js';

/** Persisted defaults and user models are the SAME collection. No generated fallback records. */
export function ModelManager({ t, items, onOpen, onEdit, onDelete, onRefresh, onRestoreDefaults, onNew, onRename, disabled, loading, error, activeTitle }: {
  t: Translate; items: AnalysisSummary[]; defaultModelIds?: readonly string[];
  onOpen: (id: string) => void; onEdit: (id: string) => void; onDelete: (id: string) => void; onRefresh: () => void; onRestoreDefaults?: () => void;
  onNew: () => void; onRename: () => void; onCopy?: () => void; disabled: boolean;
  loading: boolean; error: string; activeTitle?: string; views?: ReactNode; legacy?: ReactNode;
}) {
  return <section className="rds-sb-models" aria-label={t('models')}>
    <h3><Icon name="models" />{t('models')}</h3>
    {loading && <p role="status">{t('loading')}</p>}
    {error && <p role="alert">{error}</p>}
    {items.length > 0 ? <div className="rds-sb-model-cards">{items.map(item => <div key={item.id} className="rds-sb-model-card">
      <button className="rds-sb-model-open" type="button" disabled={disabled || loading} onClick={() => onOpen(item.id)}>{item.title}</button>
      <div className="rds-sb-card-icons">
        <button type="button" disabled={disabled || loading} aria-label={`${t('editModel')}: ${item.title}`} title={t('editModel')} onClick={() => onEdit(item.id)}><Icon name="edit" /></button>
        <button type="button" disabled={disabled || loading || item.id.startsWith('legacy:')} aria-label={`${t('deleteModel')}: ${item.title}${item.id.startsWith('legacy:') ? ` — ${t('legacyDeleteUnavailable')}` : ''}`} title={t(item.id.startsWith('legacy:') ? 'legacyDeleteUnavailable' : 'deleteModel')} onClick={() => onDelete(item.id)}><Icon name="delete" /></button>
      </div>
      {item.id.startsWith('legacy:') && <small className="rds-sb-legacy-note">{t('legacyDeleteUnavailable')}</small>}
    </div>)}</div> : !loading && <p className="rds-sb-muted">{t('noModels')}</p>}
    {activeTitle && <p className="rds-sb-model-active">{t('editingModel')}: <strong>{activeTitle}</strong></p>}
    <div className="rds-sb-model-actions"><button type="button" disabled={disabled} onClick={onNew}>{t('createVisualization')}</button><button type="button" disabled={disabled} onClick={onRename}>{t('rename')}</button></div>
    <details className="rds-sb-model-tools"><summary>{t('manageModels')}</summary>
      <p className="rds-sb-muted">{t('modelManagementHelp')}</p>
      <button type="button" disabled={disabled || loading} onClick={onRefresh}>{t('refreshModels')}</button>
      {onRestoreDefaults && <button type="button" disabled={disabled || loading} onClick={onRestoreDefaults}>{t('restoreDefaults')}</button>}
    </details>
  </section>;
}
