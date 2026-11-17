import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Locale } from './i18n/messages';
import { AUTO_DOWNLOAD_KEY, canInstallUpdate, isUpdateStatus, readAutoDownload, updateBusy, updateProgress, type UpdateStatus } from './updates';

const labels = {
  'en-US': {
    title: 'Application updates', check: 'Check for updates', download: 'Download update',
    install: 'Install and restart', later: 'Later', close: 'Close',
    auto: 'Download updates automatically', disabled: 'Updates are unavailable in this build or installation format.',
    idle: 'Check for a newer version.', checking: 'Checking for updates…',
    current: 'You are using the latest available version.', available: 'An update is available.',
    downloading: 'Downloading and verifying the update…', ready: 'Update downloaded and signature verified.',
    installing: 'Installing the update…', error: 'Could not complete the update. Check your connection and try again.',
    protected: 'Save or finish your edits and other operations before installing.',
    confirm: 'The application will close to install this update and restart. Your imported data and saved templates will be preserved.',
    version: 'Current version', newVersion: 'New version', storage: 'Could not save this preference.',
    signature: 'The update signature could not be verified. Nothing was installed.',
    tooLarge: 'The update exceeds the allowed download size. Nothing was installed.',
  },
  'pt-BR': {
    title: 'Atualizações do aplicativo', check: 'Verificar atualizações', download: 'Baixar atualização',
    install: 'Instalar e reiniciar', later: 'Mais tarde', close: 'Fechar',
    auto: 'Baixar atualizações automaticamente', disabled: 'Atualizações indisponíveis neste build ou formato de instalação.',
    idle: 'Verifique se há uma nova versão.', checking: 'Verificando atualizações…',
    current: 'Você está usando a versão mais recente disponível.', available: 'Há uma atualização disponível.',
    downloading: 'Baixando e verificando a atualização…', ready: 'Atualização baixada e assinatura verificada.',
    installing: 'Instalando a atualização…', error: 'Não foi possível concluir a atualização. Verifique sua conexão e tente novamente.',
    protected: 'Salve ou finalize suas edições e outras operações antes de instalar.',
    confirm: 'O aplicativo será fechado para instalar a atualização e reiniciado. Seus dados importados e modelos salvos serão preservados.',
    version: 'Versão atual', newVersion: 'Nova versão', storage: 'Não foi possível salvar esta preferência.',
    signature: 'Não foi possível verificar a assinatura da atualização. Nada foi instalado.',
    tooLarge: 'A atualização ultrapassa o tamanho permitido para download. Nada foi instalado.',
  },
} as const;

export function UpdateDialog({ locale, open, onClose, onOpen, dirty, blocked }: {
  locale: Locale; open: boolean; onClose: () => void; onOpen: () => void; dirty: boolean; blocked: boolean;
}) {
  const t = labels[locale];
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [auto, setAuto] = useState(() => {
    try { return readAutoDownload(window.localStorage); } catch { return false; }
  });
  const [localError, setLocalError] = useState(false);
  const [operationBlocked, setOperationBlocked] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  const autoRef = useRef(auto);
  const apply = useCallback((value: UpdateStatus) => {
    if (!isUpdateStatus(value)) throw new Error('Invalid update status');
    if (mounted.current) setStatus(value);
    return value;
  }, []);
  const download = useCallback(async () => apply(await invoke<UpdateStatus>('update_download')), [apply]);
  const check = useCallback(async () => {
    if (running.current || !isTauri()) return;
    running.current = true;
    setLocalError(false);
    setOperationBlocked(false);
    try {
      const value = apply(await invoke<UpdateStatus>('update_check'));
      if (value.enabled && value.phase === 'available' && autoRef.current) await download();
    } catch { if (mounted.current) setLocalError(true); }
    finally { running.current = false; }
  }, [apply, download]);

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    if (isTauri()) void invoke<UpdateStatus>('update_status').then(value => { if (alive) apply(value); }).catch(() => {});
    const timer = window.setTimeout(() => { if (alive) void check(); }, 5000);
    const interval = window.setInterval(() => { if (alive) void check(); }, 6 * 60 * 60 * 1000);
    return () => { alive = false; mounted.current = false; window.clearTimeout(timer); window.clearInterval(interval); };
  }, [apply, check]);
  useEffect(() => {
    if (!isTauri() || (!open && !updateBusy(status))) return;
    let alive = true;
    const poll = () => { void invoke<UpdateStatus>('update_status').then(value => { if (alive) apply(value); }).catch(() => {}); };
    poll();
    const timer = window.setInterval(poll, 750);
    return () => { alive = false; window.clearInterval(timer); };
  }, [open, status?.phase, apply]);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) { dialog.current.showModal(); cancel.current?.focus(); }
    if (!open && dialog.current?.open) { dialog.current.close(); setConfirm(false); }
  }, [open]);
  const close = () => { if (status?.phase !== 'installing') { setConfirm(false); onClose(); } };
  const busy = updateBusy(status);
  const install = async () => {
    if (running.current || !canInstallUpdate(status, dirty, blocked)) return;
    if (!confirm) { setConfirm(true); return; }
    running.current = true;
    setLocalError(false);
    setOperationBlocked(false);
    try { await invoke('update_install', { confirmed: true }); }
    catch (error) { setLocalError(true); setConfirm(false); setOperationBlocked(String(error).includes('UPDATE_SYNC_BUSY')); }
    finally { running.current = false; }
  };
  const manualDownload = async () => {
    if (running.current) return;
    running.current = true; setLocalError(false);
    setOperationBlocked(false);
    try { await download(); } catch { setLocalError(true); }
    finally { running.current = false; }
  };
  const phase = status?.phase ?? 'disabled';
  const progress = status ? updateProgress(status) : null;
  return <>
    {!open && status?.enabled && ['available', 'ready'].includes(phase) &&
      <button type="button" className="update-notice" onClick={onOpen}>{t.available} {status.version}</button>}
    <dialog ref={dialog} className="update-dialog" aria-labelledby="update-title" onCancel={event => { event.preventDefault(); close(); }}>
      <h2 id="update-title">{t.title}</h2>
      {status && <p>{t.version}: {status.currentVersion}{status.version && <> · {t.newVersion}: {status.version}</>}</p>}
      <p role="status">{t[phase]}</p>
      {phase === 'downloading' && <progress aria-label={t.downloading} {...(progress === null ? {} : { value: progress, max: 100 })} />}
      {status?.notes && <pre className="update-notes">{status.notes}</pre>}
      <label className="update-preference"><input type="checkbox" checked={auto} disabled={!status?.enabled || phase === 'installing'} onChange={event => {
        const value = event.target.checked;
        setAuto(value); autoRef.current = value; setStorageError(false);
        try { window.localStorage.setItem(AUTO_DOWNLOAD_KEY, String(value)); } catch { setStorageError(true); }
        if (value && phase === 'available') void manualDownload();
      }} />{t.auto}</label>
      {storageError && <p role="alert">{t.storage}</p>}
      {(localError || phase === 'error') && <p role="alert">{operationBlocked || status?.error === 'UPDATE_SYNC_BUSY' ? t.protected : status?.error === 'UPDATE_SIGNATURE_INVALID' ? t.signature : status?.error === 'UPDATE_TOO_LARGE' ? t.tooLarge : t.error}</p>}
      {(dirty || blocked) && <p>{t.protected}</p>}
      {confirm && <p role="alert">{t.confirm}</p>}
      <div className="update-actions">
        {phase === 'ready'
          ? <button type="button" disabled={!canInstallUpdate(status, dirty, blocked)} onClick={() => void install()}>{t.install}</button>
          : phase === 'available' || (phase === 'error' && status?.version)
            ? <button type="button" disabled={busy} onClick={() => void manualDownload()}>{t.download}</button>
            : <button type="button" disabled={!status?.enabled || busy} onClick={() => void check()}>{t.check}</button>}
        <button type="button" ref={cancel} disabled={phase === 'installing'} onClick={close}>{confirm ? t.later : t.close}</button>
      </div>
    </dialog>
  </>;
}
