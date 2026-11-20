import { useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sandbox } from '@rds/sandbox-react';
import { EChartsRenderer, exportChartImage } from '@rds/sandbox-echarts';
import '@rds/sandbox-react/style.css';
import type { Locale } from '../../i18n/messages';
import { createF1AnalysisProvider } from './analysis-provider';
import { createF1AnalysisStore } from './analysis-store';
import { createImageExporter, createTextExporter } from './export-service';
import { defaultModelIds } from './default-models';
import type { TutorialBridge } from '../../onboarding';

export default function AnalysisScreen({ locale, tutorial }: { locale: Locale; tutorial?: TutorialBridge }) {
  const provider = useMemo(() => createF1AnalysisProvider(
    (revisions) => invoke('f1_analysis_pinned', { revisions }),
    Date.now,
    (revisions) => invoke('f1_analysis_catalog', revisions ? { revisions } : undefined),
  ), []);
  const store = useMemo(() => createF1AnalysisStore(invoke), []);
  const onTutorialTarget = useCallback((target: string, element: HTMLElement | null) => tutorial?.onTarget(target, element), [tutorial?.onTarget]);
  const host = useMemo(() => ({ defaultModelIds, supportsExportManifest: true, exportFiles: createTextExporter((command, args) => invoke<boolean>(command, args)), exportImage: createImageExporter((command, args) => invoke<boolean>(command, args)), onDirtyChange: tutorial?.onDirtyChange, restoreDefaultModels: async (signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await invoke('f1_models_restore_defaults');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  } }), [tutorial?.onDirtyChange]);
  const messages = useMemo(() => locale === 'pt-BR' ? { compareSelections: 'Comparar temporadas', comparisonSelection: 'Temporada de comparação', chartHelp: 'Exploração dos resultados, não classificação oficial. Gráfico aproximado; valores exatos na tabela.', exportPrivacy: 'Exportações ficam no dispositivo. O CSV aceita um manifesto opcional. SVG e PNG podem incluir ou omitir a legenda.' } : { compareSelections: 'Compare seasons', comparisonSelection: 'Comparison season', chartHelp: 'Result exploration, not official standings. Approximate chart; exact values are available in the table.', exportPrivacy: 'Exports stay on this device. CSV can include a companion manifest. SVG and PNG can include or omit the legend.' }, [locale]);
  return <Sandbox provider={provider} store={store} host={host} locale={locale} messages={messages} ChartRenderer={EChartsRenderer} chartExporter={exportChartImage} tutorialTargets={onTutorialTarget} />;
}
