import { useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sandbox } from '@rds/sandbox-react';
import { EChartsRenderer } from '@rds/sandbox-echarts';
import '@rds/sandbox-react/style.css';
import type { Locale } from '../../i18n/messages';
import { createF1AnalysisProvider } from './analysis-provider';
import { createF1AnalysisStore } from './analysis-store';

export default function AnalysisScreen({ locale }: { locale: Locale }) {
  const provider = useMemo(() => createF1AnalysisProvider((revisions) => revisions ? invoke('f1_analysis_pinned', { revisions }) : invoke('f1_analysis_snapshots')), []);
  const store = useMemo(() => createF1AnalysisStore(invoke), []);
  const messages = useMemo(() => locale === 'pt-BR' ? { compareSelections: 'Comparar temporadas', comparisonSelection: 'Temporada de comparação', chartHelp: 'Exploração dos resultados, não classificação oficial. Gráfico aproximado; valores exatos na tabela.' } : { compareSelections: 'Compare seasons', comparisonSelection: 'Comparison season', chartHelp: 'Result exploration, not official standings. Approximate chart; exact values are available in the table.' }, [locale]);
  return <Sandbox provider={provider} store={store} locale={locale} messages={messages} ChartRenderer={EChartsRenderer} />;
}
