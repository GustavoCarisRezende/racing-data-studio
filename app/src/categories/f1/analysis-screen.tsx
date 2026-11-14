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
  const messages = useMemo(() => locale === 'pt-BR' ? { compareSelections: 'Comparar temporadas', comparisonSelection: 'Temporada de comparação', chartHelp: 'Exploração dos resultados, não classificação oficial. Gráfico aproximado; valores exatos na tabela.', exportPrivacy: 'Exportação experimental: CSV e manifesto exigem diálogos separados e nomes novos. O manifesto inclui filtros, revisões e licenças; os arquivos permanecem locais.' } : { compareSelections: 'Compare seasons', comparisonSelection: 'Comparison season', chartHelp: 'Result exploration, not official standings. Approximate chart; exact values are available in the table.', exportPrivacy: 'Experimental export: CSV and manifest require separate dialogs and new filenames. The manifest includes filters, revisions and licenses; files remain local.' }, [locale]);
  return <Sandbox provider={provider} store={store} host={host} locale={locale} messages={messages} ChartRenderer={EChartsRenderer} chartExporter={exportChartImage} />;
}
