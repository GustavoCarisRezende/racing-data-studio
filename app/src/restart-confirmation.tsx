import { useEffect, useRef } from 'react';
import type { Locale } from './i18n/messages';

export function RestartConfirmation({ open, locale, navigation = false, onCancel, onConfirm }: {
  open: boolean; locale: Locale; navigation?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const portuguese = locale === 'pt-BR';
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    }
    else if (!open && dialog?.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="restart-dialog" aria-labelledby="restart-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="restart-title">{locale === 'pt-BR' ? 'Descartar alterações?' : 'Discard unsaved changes?'}</h2>
    <p>{navigation
      ? (portuguese ? 'Se prosseguir, você perderá as alterações não salvas deste modelo.' : 'If you continue, you will lose the unsaved changes to this model.')
      : (portuguese ? 'Há alterações não salvas. Reiniciar o tour voltará para a tela inicial.' : 'There are unsaved changes. Restarting the tour returns to the home screen.')}</p>
    <div>
      <button type="button" onClick={() => { ref.current?.close(); onConfirm(); }}>{navigation ? (portuguese ? 'Prosseguir e descartar' : 'Continue and discard') : (portuguese ? 'Reiniciar tour' : 'Restart tour')}</button>
      <button ref={cancelRef} type="button" onClick={onCancel}>{portuguese ? 'Cancelar' : 'Cancel'}</button>
    </div>
  </dialog>;
}
