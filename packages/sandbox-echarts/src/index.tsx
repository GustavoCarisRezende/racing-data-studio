import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core.js';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts.js';
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption, ScatterSeriesOption } from 'echarts/charts.js';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components.js';
import type { AriaComponentOption, GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components.js';
import { SVGRenderer } from 'echarts/renderers.js';
import type { ChartModel } from '@rds/sandbox-core';
// No dataset transforms, eval, WASM, Workers, maps, remote loaders or HTML toolbox.
echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, AriaComponent, SVGRenderer]);
export type SandboxChartOption = echarts.ComposeOption<BarSeriesOption | LineSeriesOption | PieSeriesOption | ScatterSeriesOption | AriaComponentOption | GridComponentOption | LegendComponentOption | TooltipComponentOption>;
const colors = ['#ff7997', '#65b5ff', '#ffc66d', '#73d8bd', '#d9a3ff', '#e3e6ef'];

/** Only translates a bounded, library-owned model. Never pass external ECharts options. */
export function toEChartsOption(model: ChartModel): SandboxChartOption {
  const safe = (v: number) => Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
  if (model.kind === 'pie' || model.kind === 'scatter') {
    if (model.series.length > 100) throw new Error('Invalid chart model');
    const base = { animation: false as const, color: colors, backgroundColor: 'transparent', textStyle: { color: '#f5f7fa' }, aria: { enabled: true, label: { enabled: true, description: model.description }, decal: { show: true } }, tooltip: { trigger: 'item' as const, renderMode: 'richText' as const, confine: true }, legend: { show: false } };
    if (model.kind === 'pie') {
      if (!model.slices?.length || model.slices.length > 100 || model.slices.some(s => !safe(s.value) || s.value < 0) || !model.slices.some(s => s.value > 0)) throw new Error('Invalid pie model');
      return { ...base, series: [{ type: 'pie', radius: '65%', stillShowZeroSum: false, label: { color: '#b8c1d1' }, data: model.slices.map(s => ({ id: s.id, name: s.label, value: s.value })), emphasis: { disabled: true } }] };
    }
    if (model.series.reduce((n, s) => n + (s.points?.length ?? 0), 0) > 20_000 || model.series.some(s => !s.points || s.points.some(p => p.value.length !== 2 || p.value.some(v => !safe(v))))) throw new Error('Invalid scatter model');
    return { ...base, grid: { left: 65, right: 25, bottom: 55, top: 25 }, xAxis: { type: 'value', name: model.xLabel, nameLocation: 'middle', nameGap: 35, scale: true }, yAxis: { type: 'value', name: model.yLabel, nameLocation: 'middle', nameGap: 45, scale: true }, series: model.series.map(s => ({ id: s.id, name: s.label, type: 'scatter', symbolSize: 9, data: s.points!.map(p => ({ id: p.id, name: p.label, value: p.value })), emphasis: { disabled: true } })) };
  }
  if (!['line', 'bar'].includes(model.kind) || model.series.length > 100 || model.categories.length * model.series.length > 20_000 || model.series.some(s => s.values.length !== model.categories.length || s.values.some(v => v !== null && (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER)))) throw new Error('Invalid chart model');
  return {
    animation: false,
    color: colors,
    backgroundColor: 'transparent',
    textStyle: { color: '#f5f7fa', fontFamily: 'sans-serif' },
    aria: { enabled: true, label: { enabled: true, description: model.description }, decal: { show: true } },
    grid: { left: 60, right: 18, top: 22, bottom: 52 },
    // No HTML interpolation, callbacks from documents, CSS strings or URL actions.
    tooltip: { trigger: 'axis', renderMode: 'richText', confine: true },
    legend: { show: false, selectedMode: false },
    xAxis: { type: 'category', name: model.xLabel, nameLocation: 'middle', nameGap: 40, data: model.categories.map(c => c.label), axisLabel: { color: '#b8c1d1', hideOverlap: true }, axisLine: { lineStyle: { color: '#535d70' } } },
    yAxis: { type: 'value', name: model.yLabel, nameLocation: 'middle', nameGap: 43, nameTextStyle: { color: '#b8c1d1', fontSize: 11 }, axisLabel: { color: '#b8c1d1' }, splitLine: { lineStyle: { color: '#384153' } } },
    series: model.series.map((s, index) => ({
      id: s.id, name: s.label, type: model.kind,
      data: s.values, ...(model.kind === 'line' ? { connectNulls: false, smooth: false, showSymbol: true, symbol: ['circle', 'rect', 'triangle', 'diamond'][index % 4], lineStyle: { type: index % 2 ? 'dashed' : 'solid' } } : {}),
      emphasis: { disabled: true },
    } as BarSeriesOption | LineSeriesOption)),
  };
}

export function EChartsRenderer({ model, locale }: { model: ChartModel; locale: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    let chart: echarts.ECharts | undefined;
    let observer: ResizeObserver | undefined;
    // ECharts retains explicit init dimensions: provide fresh measurements on every resize.
    const resize = () => {
      if (!node.clientWidth || !node.clientHeight) return;
      try { chart?.resize({ width: node.clientWidth, height: node.clientHeight }); } catch { setFailed(true); }
    };
    try {
      setFailed(false);
      chart = echarts.init(node, undefined, { renderer: 'svg', locale: locale.startsWith('pt') ? 'PT-br' : 'EN', width: node.clientWidth || 640, height: node.clientHeight || 340 });
      chart.setOption(toEChartsOption(model), { notMerge: true });
      if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(resize); observer.observe(node); }
      else window.addEventListener('resize', resize);
    } catch { setFailed(true); }
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); chart?.dispose(); };
  }, [model, locale]);
  return <>{failed && <p role="alert">{locale.startsWith('pt') ? 'Não foi possível renderizar o gráfico. Consulte a tabela.' : 'The chart could not be rendered. Use the table.'}</p>}<div ref={container} className="rds-sb-chart-surface" role="img" aria-label={model.description} /><div className="rds-sb-legend-scroll" role="region" aria-label={locale.startsWith('pt') ? 'Legenda do gráfico' : 'Chart legend'} tabIndex={0}><ul className="rds-sb-legend">{model.series.map((series, index) => <li key={series.id}><span className={`rds-sb-swatch rds-sb-series-${index % colors.length}${index % 2 ? ' rds-sb-dashed' : ''}`} aria-hidden="true" />{series.label}</li>)}</ul></div></>;
}
