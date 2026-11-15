import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sandbox } from '@rds/sandbox-react';
import { EChartsRenderer, exportChartImage } from '@rds/sandbox-echarts';
import '@rds/sandbox-react/style.css';
import type { Locale } from '../../i18n/messages';
import { createF1AnalysisProvider } from './analysis-provider';
import { createF1AnalysisStore } from './analysis-store';
import { createImageExporter, createTextExporter } from './export-service';
import { defaultModelIds } from './default-models';

export default function AnalysisScreen({ locale }: { locale: Locale }) {
  const provider = useMemo(() => createF1AnalysisProvider((revisions) => revisions ? invoke('f1_analysis_pinned', { revisions }) : invoke('f1_analysis_snapshots')), []);
  const store = useMemo(() => createF1AnalysisStore(invoke), []);
  const host = useMemo(() => ({ defaultModelIds, exportFiles: createTextExporter((command, args) => invoke<boolean>(command, args)), exportImage: createImageExporter((command, args) => invoke<boolean>(command, args)), restoreDefaultModels: async (signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await invoke('f1_models_restore_defaults');
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  } }), []);
  const messages = useMemo(() => locale === 'pt-BR' ? { compareSelections: 'Comparar temporadas', comparisonSelection: 'Temporada de comparação', chartHelp: 'Exploração dos resultados, não classificação oficial. Gráfico aproximado; valores exatos na tabela.', exportPrivacy: 'Exportações ficam no dispositivo. CSV exporta somente a tabela; SVG e PNG podem incluir ou omitir a legenda.' } : { compareSelections: 'Compare seasons', comparisonSelection: 'Comparison season', chartHelp: 'Result exploration, not official standings. Approximate chart; exact values are available in the table.', exportPrivacy: 'Exports stay on this device. CSV exports the table only; SVG and PNG can include or omit the legend.' }, [locale]);
  return <Sandbox provider={provider} store={store} host={host} locale={locale} messages={messages} ChartRenderer={EChartsRenderer} chartExporter={exportChartImage} />;
}
