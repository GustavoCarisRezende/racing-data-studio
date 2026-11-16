import { useEffect, useRef } from 'react';
import type { Locale } from './i18n/messages';

export function RestartConfirmation({ open, locale, onCancel, onConfirm }: {
  open: boolean; locale: Locale; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="restart-dialog" aria-labelledby="restart-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="restart-title">{locale === 'pt-BR' ? 'Descartar alterações?' : 'Discard unsaved changes?'}</h2>
    <p>{locale === 'pt-BR' ? 'Há alterações não salvas. Reiniciar o tour voltará para a tela inicial.' : 'There are unsaved changes. Restarting the tour returns to the home screen.'}</p>
    <div>
      <button type="button" onClick={onConfirm}>{locale === 'pt-BR' ? 'Reiniciar tour' : 'Restart tour'}</button>
      <button type="button" onClick={onCancel}>{locale === 'pt-BR' ? 'Cancelar' : 'Cancel'}</button>
    </div>
  </dialog>;
}
