import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sandbox } from '@rds/sandbox-react';
import { EChartsRenderer } from '@rds/sandbox-echarts';
import { createF1AnalysisProvider, descriptor } from '../../app/src/categories/f1/analysis-provider';
import { createMemoryStore, createMemoryModelStore } from './memory-provider.mjs';
import { restoreSyntheticModels } from './synthetic-models.mjs';
import { syntheticSnapshots } from './synthetic-f1.mjs';
import logo from '../../app/src/assets/rds-logo.svg';
import background from '../../app/src/assets/header-background.svg';
import '../../app/src/style.css';
import '@rds/sandbox-react/style.css';

// The same F1 adapter as the app, but no Tauri import or native bridge is used.
const provider = createF1AnalysisProvider(async () => structuredClone(syntheticSnapshots));
const describe = provider.describeDataset.bind(provider);
provider.describeDataset = async (request, signal) => ({ ...await describe(request, signal), sources: [{ name: 'Synthetic test fixture', attribution: 'Invented drivers, teams and results — Racing Data Studio test suite', license: 'Apache-2.0' }] });
const store = createMemoryStore(descriptor);
store.modelsV3 = createMemoryModelStore(descriptor, 3);
const host = { restoreDefaultModels: (signal?: AbortSignal) => restoreSyntheticModels(descriptor, store, 'pt-BR', signal) };
function Smoke() {
  const [locale, setLocale] = useState<'pt-BR' | 'en-US'>('pt-BR');
  const messages = useMemo(() => locale === 'pt-BR' ? { compareSelections: 'Comparar temporadas', comparisonSelection: 'Temporada de comparação', chartHelp: 'Exploração dos resultados, não classificação oficial. Gráfico aproximado; valores exatos na tabela.' } : { compareSelections: 'Compare seasons', comparisonSelection: 'Comparison season', chartHelp: 'Result exploration, not official standings. Approximate chart; exact values are available in the table.' }, [locale]);
  useEffect(() => {
    // The CLI capture waits for this page's image load, released only after real SVG/data render.
    // ?selected exercises actual controls before capturing; never changes production defaults.
    const selectedScenario = new URLSearchParams(location.search).has('selected');
    const modelScenario = new URLSearchParams(location.search).get('model');
    let step = 0;
    const observer = new MutationObserver(() => {
      if (modelScenario) {
        if (step === 0) {
          const select = document.querySelector<HTMLSelectElement>('.rds-sb-models select');
          const id = `synthetic-${modelScenario}`;
          if (!select || ![...select.options].some(option => option.value === id)) return;
          step = 1; select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); return;
        }
        if (step === 1) {
          const open = [...document.querySelectorAll<HTMLButtonElement>('.rds-sb-models button')].find(node => /^(Abrir|Open)$/.test(node.textContent ?? ''));
          if (!open || open.disabled) return;
          step = 2; open.click(); return;
        }
        if (!document.querySelector('.rds-sb-model-active strong') || document.querySelector('[role=alertdialog]') || document.querySelector('[aria-busy=true]')) return;
        if (modelScenario === 'teams' && (!document.querySelector('.rds-sb-chart-types button[aria-pressed=true]')?.textContent?.includes('Pizza') || document.querySelectorAll('tbody tr').length !== 2)) return;
      }
      if (selectedScenario) {
        if (step === 0) {
          const summary = [...document.querySelectorAll('.rds-sb-quick-filter summary')].find(node => /^(Pilotos|Drivers)/.test(node.textContent ?? '')) as HTMLElement | undefined;
          if (!summary) return;
          step = 1; summary.click(); return;
        }
        if (step === 1 || step === 2) {
          const name = step === 1 ? 'Ana Lima' : 'Bruno Reis';
          const label = [...document.querySelectorAll('.rds-sb-quick-filter .rds-sb-facet label')].find(node => node.querySelector('span')?.textContent === name);
          if (!label) return;
          step++; label.querySelector<HTMLInputElement>('input')!.click(); return;
        }
        if (step === 3) {
          const summary = [...document.querySelectorAll('.rds-sb-quick-filter summary')].find(node => /^(Temporada|Season)/.test(node.textContent ?? '')) as HTMLElement | undefined;
          if (!summary) return;
          step = 4; summary.click(); return;
        }
        if (step === 4) {
          const label = [...document.querySelectorAll('.rds-sb-quick-filter[open] .rds-sb-facet label')].find(node => node.querySelector('span')?.textContent === '2024');
          if (!label) return;
          step = 5; label.querySelector<HTMLInputElement>('input')!.click(); return;
        }
        if (!document.querySelector('.rds-sb-preview summary')?.textContent?.includes('56') || document.querySelectorAll('.rds-sb-legend li').length !== 4) return;
      }
      if ((document.querySelector('.rds-sb-chart-surface svg') || document.querySelector('.rds-sb-visualization table')) && document.querySelector('tbody tr') && !document.querySelector('[aria-busy=true]')) {
        observer.disconnect(); void fetch(`/ready?ticket=${document.body.dataset.capture}`, { method: 'POST' });
      }
    });
    observer.observe(document.getElementById('root')!, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-pressed', 'aria-busy'] });
    return () => observer.disconnect();
  }, []);
  return <div className="app-shell"><header className="masthead"><div className="brand"><img className="brand-image" src={logo} alt="Racing Data Studio" /><span className="brand-separator" /><strong className="brand-text">Racing Data Studio</strong></div><label className="locale-control">Idioma <select aria-label="Idioma" value={locale} onChange={e => setLocale(e.target.value as typeof locale)}><option value="pt-BR">Português (Brasil)</option><option value="en-US">English (US)</option></select></label></header>
    <main className="main"><img className="background-art" src={background} alt="" /><div className="content"><div className="module-screen"><p className="back">{locale === 'pt-BR' ? 'Validação visual · DADOS SINTÉTICOS · sem SQLite ou rede externa' : 'Visual validation · SYNTHETIC DATA · no SQLite or external network'}</p><section className="f1-screen"><h1>{locale === 'pt-BR' ? 'Fórmula 1 · Sandbox de dados' : 'Formula 1 · Data sandbox'}</h1><p className="f1-analysis-description">{locale === 'pt-BR' ? 'Escolha temporadas, filtre pilotos e equipes e crie sua visualização.' : 'Choose seasons, filter drivers and teams and build a visualization.'}</p><div className="f1-sandbox"><Sandbox provider={provider} store={store} host={host} locale={locale} messages={messages} ChartRenderer={EChartsRenderer} /></div></section></div></div></main>
  </div>;
}
void restoreSyntheticModels(descriptor, store).then(() => createRoot(document.getElementById('root')!).render(<Smoke />));
