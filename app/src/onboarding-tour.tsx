import { useEffect, useRef, useState } from 'react';
import type { Locale } from './i18n/messages';
import type { TutorialAction, TutorialCornerRadii, TutorialRect, TutorialState, TutorialStep } from './onboarding';
import { afterSyncExplanation, tutorialCornerRadii, tutorialCutoutPath, tutorialRect, tutorialShields } from './onboarding';

type Definition = { target?: string; en: [string, string]; pt: [string, string] };
const backupNote: Record<Locale, string> = {
  'en-US': 'In the desktop app, choose Create backup to keep a ZIP you can restore if you lose your data. If you share it, credit Jolpica F1 and follow the data license (CC BY-NC-SA 4.0).',
  'pt-BR': 'No desktop, use Criar Backup para guardar um ZIP e recuperar os dados em caso de perda. Se compartilhar o arquivo, dê crédito à Jolpica F1 e respeite a licença dos dados (CC BY-NC-SA 4.0).',
};
const copy: Record<TutorialStep, Definition> = {
  welcome: { en: ['Welcome to Racing Data Studio', 'A local-first workspace for exploring motorsport data. Choose a category, inspect its data source, explore reported results, then build an analysis in the Sandbox.'], pt: ['Boas-vindas ao Racing Data Studio', 'Um espaço local para explorar dados de automobilismo. Escolha uma categoria, confira a fonte dos dados, explore resultados informados e monte uma análise no Sandbox.'] },
  category: { target: 'category-f1', en: ['Choose a category', 'Each category is an independent module with its own source, rules, and local data. Formula 1 is available in this workspace.'], pt: ['Escolha uma categoria', 'Cada categoria é um módulo independente, com fonte, regras e dados locais próprios. Fórmula 1 está disponível neste espaço.'] },
  'sync-intro': { en: ['How season data gets here', 'Season data is fetched from Jolpica F1, a successor to Ergast. A manual import stores a local snapshot on this device; data is not sent to Racing Data Studio servers.'], pt: ['Como os dados de temporadas chegam aqui', 'Os dados vêm da Jolpica F1, sucessora da Ergast. Uma importação manual salva um snapshot local neste dispositivo; os dados não são enviados a servidores do Racing Data Studio.'] },
  'sync-tab': { target: 'f1-sync-tab', en: ['Open synchronization', 'Choose Manage synchronizations to review the catalog and import controls. Opening the tab does not start a network import.'], pt: ['Abra sincronizações', 'Escolha Gerenciar sincronizações para ver o catálogo e os controles de importação. Abrir a aba não inicia uma importação pela rede.'] },
  'sync-content': { en: ['Import only when you choose', 'The catalog may contact Jolpica F1. An import or update starts only when you press its button. A local snapshot already exists, so another import is optional.'], pt: ['Importe somente quando quiser', 'O catálogo pode acessar a Jolpica F1. A importação ou atualização só começa quando você pressiona o botão. Já existe um snapshot local, então outra importação é opcional.'] },
  'sync-year': { target: 'f1-sync-year', en: ['Choose a season', 'The previous calendar year is suggested when available. Select that year explicitly; if it is unavailable, choose an available year instead.'], pt: ['Escolha uma temporada', 'O ano-calendário anterior é sugerido quando disponível. Selecione-o explicitamente; se não estiver disponível, escolha outro ano disponível.'] },
  'sync-run': { target: 'f1-sync-run', en: ['Start synchronization', 'Import or update the selected season. The tour continues only after success. On failure, review the error and retry, or skip the tour.'], pt: ['Inicie a sincronização', 'Importe ou atualize a temporada selecionada. O tour só continua após o sucesso. Se falhar, confira o erro e tente novamente ou pule o tour.'] },
  'snapshot-content': { en: ['Snapshots stay on this device', 'A snapshot is a locally stored version of a season. You can inspect existing snapshots without importing another season.'], pt: ['Snapshots ficam neste dispositivo', 'Um snapshot é uma versão local de uma temporada. Você pode consultar os snapshots existentes sem importar outra temporada.'] },
  'snapshots-tab': { target: 'f1-snapshots-tab', en: ['Open snapshots', 'Open Manage snapshots to see the locally stored season versions. The tour will not change or restore them.'], pt: ['Abra snapshots', 'Abra Gerenciar snapshots para ver as versões locais das temporadas. O tour não vai alterar nem restaurar snapshots.'] },
  'snapshots-content': { en: ['Review local snapshots', 'The list shows stored versions and which one is active. Browsing snapshots does not copy, activate, or delete data.'], pt: ['Confira snapshots locais', 'A lista mostra versões armazenadas e qual está ativa. Consultar snapshots não copia, ativa nem exclui dados.'] },
  'source-tab': { target: 'f1-source-tab', en: ['Open the data source', 'Review where the data comes from before interpreting results.'], pt: ['Abra a fonte dos dados', 'Confira a origem dos dados antes de interpretar os resultados.'] },
  'source-content': { en: ['Jolpica F1 and local storage', 'Jolpica F1 is the successor to Ergast. Imports are requested directly from that source and stored locally here; attribution, license, and data limitations are listed on this page.'], pt: ['Jolpica F1 e armazenamento local', 'A Jolpica F1 é sucessora da Ergast. As importações são solicitadas diretamente à fonte e armazenadas localmente; atribuição, licença e limitações dos dados estão nesta página.'] },
  'explore-tab': { target: 'f1-explore-tab', en: ['Open event exploration', 'Choose Explore events to browse the season calendar and its reported results.'], pt: ['Abra exploração de eventos', 'Escolha Explorar eventos para navegar pelo calendário e pelos resultados informados.'] },
  'explore-content': { en: ['Explore calendar and results', 'Browse events, search the calendar, and inspect the results reported for each event. Availability can vary by season.'], pt: ['Explore calendário e resultados', 'Navegue pelos eventos, pesquise o calendário e consulte os resultados informados para cada evento. A disponibilidade varia por temporada.'] },
  'sandbox-tab': { target: 'f1-sandbox-tab', en: ['Open the Sandbox', 'Choose the Sandbox to configure an exploratory analysis from local snapshots. Nothing is selected or saved by the tour.'], pt: ['Abra o Sandbox', 'Escolha o Sandbox para configurar uma análise exploratória com snapshots locais. O tour não seleciona nem salva nada.'] },
  models: { target: 'models', en: ['Models', 'Choose or manage reusable analysis models. The tour does not choose one for you.'], pt: ['Modelos', 'Escolha ou gerencie modelos de análise reutilizáveis. O tour não escolhe um por você.'] },
  filters: { target: 'filters', en: ['Filters', 'Narrow results to the drivers, teams, or events you want to compare.'], pt: ['Filtros', 'Restrinja os resultados aos pilotos, equipes ou eventos que deseja comparar.'] },
  seasons: { target: 'seasons', en: ['Compare seasons', 'Choose one or more locally stored seasons. A comparison can use multiple seasons, but does not require two.'], pt: ['Compare temporadas', 'Escolha uma ou mais temporadas armazenadas localmente. A comparação pode usar várias temporadas, mas não exige duas.'] },
  'chart-types': { target: 'chart-types', en: ['Chart type', 'Choose a chart to present the comparison.'], pt: ['Tipo de gráfico', 'Escolha um gráfico para apresentar a comparação.'] },
  'mode-switch': { target: 'mode-switch', en: ['View mode', 'Switch between configuring a view and reviewing its results.'], pt: ['Modo de visualização', 'Alterne entre configurar uma visualização e conferir seus resultados.'] },
  fields: { target: 'fields', en: ['Fields: axes and metrics', 'Fields determine what appears in the view: for example, a driver on one axis and points as a metric. The selected aggregation controls how values are combined.'], pt: ['Campos: eixos e métricas', 'Os campos definem o que aparece: por exemplo, piloto em um eixo e pontos como métrica. A agregação selecionada define como os valores são combinados.'] },
  behavior: { target: 'behavior', en: ['Analysis behavior', 'Adjust options such as combining events or showing a legend. Availability depends on the selected chart and fields.'], pt: ['Comportamento da análise', 'Ajuste opções como unificar eventos ou exibir legenda. As opções dependem do gráfico e dos campos selecionados.'] },
  'visualization-title': { target: 'visualization-title', en: ['Visualization title', 'Give the current visualization a descriptive title.'], pt: ['Título da visualização', 'Dê um título descritivo à visualização atual.'] },
  save: { target: 'save', en: ['Save a reusable model', 'Save the current configuration as a reusable model when you are ready.'], pt: ['Salve um modelo reutilizável', 'Salve a configuração atual como um modelo reutilizável quando estiver pronto.'] },
  export: { target: 'export', en: ['Export', 'Export results in an available format. An export starts only when you choose it.'], pt: ['Exporte', 'Exporte os resultados em um formato disponível. A exportação só começa quando você escolher.'] },
  finish: { en: ['You are ready to explore', 'You can restart this tour at any time from the header.'], pt: ['Pronto para explorar', 'Você pode reiniciar este tour a qualquer momento pelo cabeçalho.'] },
};
const ordered: TutorialStep[] = [
  'welcome', 'category', 'sync-intro', 'sync-tab', 'sync-content', 'sync-year', 'sync-run',
  'snapshot-content', 'snapshots-tab', 'snapshots-content', 'source-tab', 'source-content',
  'explore-tab', 'explore-content', 'sandbox-tab', 'models', 'filters', 'seasons',
  'chart-types', 'mode-switch', 'fields', 'behavior', 'visualization-title', 'save', 'export', 'finish',
];
const gates = new Set<TutorialStep>(['category', 'sync-tab', 'sync-year', 'sync-run', 'snapshots-tab', 'source-tab', 'explore-tab', 'sandbox-tab']);
export const nextTutorialStep = (step: TutorialStep): TutorialStep | undefined => ordered[ordered.indexOf(step) + 1];
export const previousTutorialStep = (step: TutorialStep): TutorialStep | undefined => step === 'snapshot-content'
  ? 'sync-content'
  : ordered[ordered.indexOf(step) - 1];

export function OnboardingTour({ state, locale, dispatch, targetElement, onMissingTarget, onBack, hasLocalSnapshots = false }: {
  state: TutorialState; locale: Locale; dispatch: (action: TutorialAction) => void;
  targetElement?: (target: string) => HTMLElement | null;
  onMissingTarget?: (step: TutorialStep) => void;
  onBack?: (step: TutorialStep) => void;
  hasLocalSnapshots?: boolean;
}) {
  const [rect, setRect] = useState<TutorialRect | null>(null);
  const [cornerRadii, setCornerRadii] = useState<TutorialCornerRadii | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [targetNode, setTargetNode] = useState<HTMLElement | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number; arrow: 'top' | 'bottom' | 'none' }>({ top: 80, left: 12, arrow: 'none' });
  const cardRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const definition = state.step ? copy[state.step] : null;
  const text = definition ? (locale === 'pt-BR' ? definition.pt : definition.en) : null;
  const activeText = state.step === 'sync-content' && !hasLocalSnapshots
    ? locale === 'pt-BR'
      ? ['Importação manual e snapshot local', 'Escolha uma temporada e pressione Importar para buscar os dados na Jolpica F1 e salvar um snapshot neste dispositivo. Nada é importado automaticamente.']
      : ['Manual import and local snapshot', 'Choose a season and press Import to fetch data from Jolpica F1 and save a snapshot on this device. Nothing is imported automatically.']
    : text;
  const stageText = state.step === 'snapshot-content' && !hasLocalSnapshots
    ? locale === 'pt-BR'
      ? ['Snapshots são locais', 'Quando você importar uma temporada no aplicativo desktop, o snapshot ficará neste dispositivo. Nenhuma importação é necessária para continuar este tour.']
      : ['Snapshots are local', 'When you import a season in the desktop app, its snapshot stays on this device. No import is required to continue this tour.']
    : state.step === 'snapshots-content' && !hasLocalSnapshots
      ? locale === 'pt-BR'
        ? ['Lista de snapshots', 'Não há snapshots locais disponíveis nesta sessão. No desktop, esta tela lista versões armazenadas sem alterar os dados.']
        : ['Snapshot list', 'No local snapshots are available in this session. In the desktop app, this screen lists stored versions without changing data.']
      : activeText;
  useEffect(() => {
    if (!state.step) { setRect(null); setCornerRadii(null); targetRef.current = null; setTargetNode(null); return; }
    const updateSuspension = () => setSuspended(Boolean(document.querySelector('.rds-sb-modal-backdrop, dialog[open]')));
    let scrolled = false;
    const update = () => {
      updateSuspension();
      if (!definition?.target) { targetRef.current = null; setTargetNode(null); setRect(null); setCornerRadii(null); return; }
      const element = targetElement?.(definition.target) ?? document.querySelector<HTMLElement>(`[data-tutorial-target="${definition.target}"]`);
      const blocked = element?.matches(':disabled,[aria-disabled="true"]') && element.getAttribute('data-tutorial-pending') !== 'true';
      if (!element?.isConnected || element.getClientRects().length === 0 || blocked) { targetRef.current = null; setTargetNode(null); setRect(null); setCornerRadii(null); return; }
      targetRef.current = element;
      setTargetNode((previous) => previous === element ? previous : element);
      if (!scrolled) { element.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'auto' }); scrolled = true; }
      const bounds = element.getBoundingClientRect();
      const next = tutorialRect(bounds, window.innerWidth, window.innerHeight);
      setRect((previous) => previous && previous.top === next.top && previous.left === next.left && previous.width === next.width && previous.height === next.height ? previous : next);
      const style = window.getComputedStyle(element);
      const nextRadii = tutorialCornerRadii(style, bounds.width, bounds.height);
      setCornerRadii((previous) => JSON.stringify(previous) === JSON.stringify(nextRadii) ? previous : nextRadii);
    };
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    const onResize = () => { setLayoutVersion((v) => v + 1); schedule(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', schedule, true);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-selected', 'class', 'open', 'disabled', 'aria-disabled', 'data-tutorial-pending'] });
    const layoutObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { setLayoutVersion((v) => v + 1); schedule(); });
    layoutObserver?.observe(document.documentElement);
    if (cardRef.current) layoutObserver?.observe(cardRef.current);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', schedule, true); observer.disconnect(); layoutObserver?.disconnect(); };
  }, [state.step, definition?.target, targetElement]);
  useEffect(() => {
    if (!targetNode || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setLayoutVersion((version) => version + 1));
    observer.observe(targetNode);
    return () => observer.disconnect();
  }, [targetNode]);
  useEffect(() => {
    const target = targetNode;
    if (!target) return;
    const previous = target.getAttribute('aria-describedby');
    const previousTabIndex = target.getAttribute('tabindex');
    const needsTabIndex = !target.matches('button, input, select, textarea, a[href], [tabindex]');
    if (needsTabIndex) target.tabIndex = -1;
    const ids = new Set((previous ?? '').split(/\s+/).filter(Boolean));
    ids.add('tutorial-copy');
    target.setAttribute('aria-describedby', [...ids].join(' '));
    return () => {
      if (previous === null) target.removeAttribute('aria-describedby'); else target.setAttribute('aria-describedby', previous);
      if (needsTabIndex) {
        if (previousTabIndex === null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex', previousTabIndex);
      }
    };
  }, [targetNode, state.step]);
  useEffect(() => {
    if (!state.step) return;
    titleRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.rds-sb-modal-backdrop, dialog[open]')) return;
      if (event.key === 'Escape') { event.preventDefault(); dispatch({ type: 'skip' }); }
      if (event.key === 'Tab' && event.target instanceof Element && targetRef.current?.isConnected) {
        const controls = [...(cardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
        const skip = document.querySelector<HTMLElement>('.tutorial-skip-fixed');
        const target = targetRef.current;
        if (event.target.matches('.tutorial-skip-fixed')) {
          event.preventDefault();
          if (event.shiftKey) target.focus(); else controls[0]?.focus();
        } else if (event.target.closest('.tutorial-card')) {
          if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); skip?.focus(); }
          else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); target.focus(); }
        } else if (event.target === target && !event.shiftKey) {
          event.preventDefault(); skip?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.step, dispatch]);
  useEffect(() => {
    if (!cardRef.current) return;
    const card = cardRef.current.getBoundingClientRect();
    if (!rect) {
      const centered = { top: Math.max(8, (window.innerHeight - card.height) / 2), left: Math.max(8, (window.innerWidth - card.width) / 2), arrow: 'none' as const };
      setPosition((p) => p.top === centered.top && p.left === centered.left && p.arrow === 'none' ? p : centered);
      return;
    }
    const below = rect.top + rect.height + 14 + card.height <= window.innerHeight - 8;
    let top = below ? rect.top + rect.height + 14 : rect.top - card.height - 14;
    let left = Math.max(8, Math.min(rect.left, window.innerWidth - card.width - 8));
    const skip = document.querySelector<HTMLElement>('.tutorial-skip-fixed')?.getBoundingClientRect();
    if (skip && top < skip.bottom && top + card.height > skip.top && left < skip.right && left + card.width > skip.left) {
      if (skip.left - card.width - 8 >= 8) left = skip.left - card.width - 8;
      else if (skip.bottom + card.height <= window.innerHeight - 8) top = skip.bottom + 8;
      else top = skip.top - card.height - 8;
    }
    top = Math.max(8, Math.min(top, window.innerHeight - card.height - 8));
    const next = { top, left, arrow: (below ? 'top' : 'bottom') as 'top' | 'bottom' };
    setPosition((p) => p.top === next.top && p.left === next.left && p.arrow === next.arrow ? p : next);
  }, [rect, state.step, locale, stageText, layoutVersion]);
  if (!state.step || !stageText || suspended) return null;
  const index = ordered.indexOf(state.step);
  const next = nextTutorialStep(state.step);
  const isGate = gates.has(state.step);
  const missing = Boolean(definition?.target && !rect);
  const continueTour = () => {
    if (state.step === 'finish') dispatch({ type: 'complete' });
    else if (missing && onMissingTarget) onMissingTarget(state.step!);
    else if (state.step === 'sync-content') dispatch({ type: 'advance', step: afterSyncExplanation(hasLocalSnapshots) });
    else if (next) dispatch({ type: 'advance', step: next });
  };
  const goBack = () => {
    const previous = previousTutorialStep(state.step!);
    if (previous && onBack) onBack(previous);
    else if (previous) dispatch({ type: 'back', step: previous });
  };
  const cutout = rect ? { top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 } : null;
  const allShields = tutorialShields(cutout, window.innerWidth, window.innerHeight, cornerRadii ?? undefined);
  return <div className="tutorial-layer" aria-live="polite">
    <svg className="tutorial-dimmer" aria-hidden="true">
      <defs><mask id="tutorial-cutout" maskUnits="userSpaceOnUse">
        <rect width="100%" height="100%" fill="white" />
        {cutout && <path d={tutorialCutoutPath(cutout, cornerRadii ?? undefined)} fill="black" />}
      </mask></defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,.72)" mask="url(#tutorial-cutout)" />
    </svg>
    {allShields.map((box, i) => <div key={i} className="tutorial-shield" aria-hidden="true" style={box} />)}
    {rect && <div className="tutorial-spotlight" aria-hidden="true" style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8, borderTopLeftRadius: cornerRadii ? `${cornerRadii.topLeft[0]}px ${cornerRadii.topLeft[1]}px` : undefined, borderTopRightRadius: cornerRadii ? `${cornerRadii.topRight[0]}px ${cornerRadii.topRight[1]}px` : undefined, borderBottomRightRadius: cornerRadii ? `${cornerRadii.bottomRight[0]}px ${cornerRadii.bottomRight[1]}px` : undefined, borderBottomLeftRadius: cornerRadii ? `${cornerRadii.bottomLeft[0]}px ${cornerRadii.bottomLeft[1]}px` : undefined }} />}
    <button className="tutorial-skip-fixed" type="button" onClick={() => dispatch({ type: 'skip' })}>{locale === 'pt-BR' ? 'Pular tutorial' : 'Skip tutorial'}</button>
    <section ref={cardRef} className={`tutorial-card tutorial-arrow-${position.arrow}`} role="dialog" aria-modal="false" aria-labelledby="tutorial-title" aria-describedby="tutorial-copy" style={{ top: position.top, left: position.left }}>
      <div className="tutorial-card-head"><span>{locale === 'pt-BR' ? `Etapa ${index + 1} de ${ordered.length}` : `Step ${index + 1} of ${ordered.length}`}</span></div>
      <h2 id="tutorial-title" ref={titleRef} tabIndex={-1}>{stageText[0]}</h2>
      <p id="tutorial-copy">{stageText[1]}{state.step === 'snapshots-content' && ` ${backupNote[locale]}`}</p>
      {missing && <p className="tutorial-target-missing" role="status">{locale === 'pt-BR' ? 'Este controle não está disponível nesta tela. Você pode continuar sem alterar os dados.' : 'This control is not available on this screen. You can continue without changing data.'}</p>}
      <div className="tutorial-actions">
        {targetNode && <button type="button" className="tutorial-secondary" onClick={() => targetRef.current?.focus()}>{locale === 'pt-BR' ? 'Focar controle' : 'Focus control'}</button>}
        <button type="button" className="tutorial-secondary" disabled={!previousTutorialStep(state.step)} onClick={goBack}>{locale === 'pt-BR' ? 'Anterior' : 'Previous'}</button>
        {(!isGate || missing) && <button type="button" onClick={continueTour}>{state.step === 'finish' ? (locale === 'pt-BR' ? 'Concluir' : 'Finish') : (locale === 'pt-BR' ? 'Próximo' : 'Next')}</button>}
      </div>
    </section>
  </div>;
}
