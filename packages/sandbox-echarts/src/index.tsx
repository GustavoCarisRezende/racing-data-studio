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
// Deterministic shared palette for chart and legend; no external CSS or user input.
const colors = Array.from({ length: 100 }, (_, i) => `hsl(${Math.round((i * 137.508) % 360)}, ${65 + (i % 2) * 20}%, ${55 + (i % 3) * 10}%)`);

export interface ImageExportOptions { format: 'svg' | 'png' | 'jpeg'; showLegend: boolean; showLabels: boolean; locale?: string }
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const cleanXml = (value: string) => Array.from(value, char => { const code = char.codePointAt(0)!; return code < 32 && ![9, 10, 13].includes(code) || code >= 0x7f && code <= 0x9f || code >= 0xd800 && code <= 0xdfff || code === 0xfffe || code === 0xffff ? '\ufffd' : char; }).join('');
const xmlText = (value: string) => cleanXml(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

/** Server-side ECharts SVG plus our own escaped, bounded legend; no DOM or remote resources. */
export function renderExportSvg(model: ChartModel, options: Pick<ImageExportOptions, 'showLegend' | 'showLabels' | 'locale'>): { svg: string; width: number; height: number } {
  if (typeof options.showLegend !== 'boolean' || typeof options.showLabels !== 'boolean' || model.series.length > 100) throw new Error('Invalid export options');
  let textSize = 0;
  const addText = (text: string) => { if (typeof text !== 'string' || text.length > 4000 || (textSize += text.length) > 1_000_000) throw new Error('Chart text exceeds export limits'); };
  for (const text of [model.title, model.description, model.xLabel, model.yLabel]) addText(text);
  if (model.categories.length > 20_000 || (model.slices?.length ?? 0) > 100) throw new Error('Chart exceeds export limits');
  for (const category of model.categories) addText(category.label);
  let pointCount = 0;
  for (const series of model.series) { addText(series.label); for (const label of series.valueLabels ?? []) addText(label); pointCount += series.points?.length ?? 0; if (pointCount > 20_000) throw new Error('Chart exceeds export limits'); for (const point of series.points ?? []) addText(point.label); }
  for (const slice of model.slices ?? []) addText(slice.label);
  const width = 1200, chartHeight = 600, titleHeight = 46;
  const legend: string[] = [];
  let y = titleHeight + chartHeight + 15;
  if (options.showLegend) for (const { index, series } of model.series.map((series, index) => ({ series, index })).sort((a, b) => a.series.label.localeCompare(b.series.label, options.locale ?? 'en-US', { numeric: true }) || (a.series.id < b.series.id ? -1 : a.series.id > b.series.id ? 1 : 0))) {
    const chars = Array.from(series.label);
    if (chars.length > 4000) throw new Error('Legend too large');
    const lines: string[] = [];
    for (let i = 0; i < chars.length; i += 90) lines.push(chars.slice(i, i + 90).join(''));
    if (!lines.length) lines.push('');
    if (y + lines.length * 20 > 4000) throw new Error('Legend too large');
    const styleIndex = series.paletteIndex ?? index;
    legend.push(`<line x1="25" y1="${y - 4}" x2="43" y2="${y - 4}" stroke="${colors[styleIndex % colors.length]}" stroke-width="3"${model.kind === 'line' && styleIndex % 2 ? ' stroke-dasharray="4 2"' : ''}/>`);
    for (const line of lines) { legend.push(`<text x="52" y="${y}" fill="#b8c1d1" font-family="sans-serif" font-size="13">${xmlText(line)}</text>`); y += 20; }
  }
  const height = options.showLegend ? Math.max(titleHeight + chartHeight, y + 8) : titleHeight + chartHeight;
  const visibleModel: ChartModel = { ...model, title: cleanXml(model.title), description: cleanXml(model.description), xLabel: cleanXml(model.xLabel), yLabel: cleanXml(model.yLabel),
    categories: model.categories.map(c => ({ ...c, label: cleanXml(c.label) })),
    series: model.series.map(s => ({ ...s, label: cleanXml(s.label), ...(s.valueLabels ? { valueLabels: s.valueLabels.map(cleanXml) } : {}), ...(s.points ? { points: s.points.map(p => ({ ...p, label: cleanXml(p.label) })) } : {}) })),
    ...(model.slices ? { slices: model.slices.map(s => ({ ...s, label: cleanXml(s.label) })) } : {}),
    ...(model.kind === 'pie' ? { piePresentation: { showLegend: options.showLegend, showLabels: options.showLabels } } : {}) };
  const chart = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width, height: chartHeight });
  let svg: string;
  try {
    chart.setOption(toEChartsOption(visibleModel), { notMerge: true });
    const inner = chart.renderToSVGString();
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><text x="25" y="28" fill="#f5f7fa" font-family="sans-serif" font-size="18">${xmlText(model.title)}</text><svg x="0" y="${titleHeight}" width="${width}" height="${chartHeight}">${inner}</svg>${legend.join('')}</svg>`;
  } finally { chart.dispose(); }
  if (new TextEncoder().encode(svg).length > MAX_IMAGE_BYTES) throw new Error('Image too large');
  return { svg, width, height };
}

/** Rasterizes only our local SVG; releases the object URL, image handlers and canvas. */
export async function exportChartImage(model: ChartModel, options: ImageExportOptions, signal?: AbortSignal): Promise<{ format: ImageExportOptions['format']; bytes: Uint8Array }> {
  if (!['svg', 'png', 'jpeg'].includes(options.format) || signal?.aborted) throw new Error('Invalid or cancelled export');
  const { svg, width, height } = renderExportSvg(model, options);
  if (options.format === 'svg') return { format: 'svg', bytes: new TextEncoder().encode(svg) };
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  let disposableImage: HTMLImageElement | undefined;
  let disposableCanvas: HTMLCanvasElement | undefined;
  try {
    const image = disposableImage = new Image();
    const canvas = disposableCanvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = (error?: Error) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); image.onload = null; image.onerror = null; error ? reject(error) : resolve(); };
      const abort = () => finish(new Error('Export aborted'));
      const timer = setTimeout(() => finish(new Error('Image rendering timed out')), 15000);
      image.onload = () => finish(); image.onerror = () => finish(new Error('Image rendering failed')); signal?.addEventListener('abort', abort, { once: true });
      try { if (signal?.aborted) abort(); else image.src = url; } catch { finish(new Error('Image rendering failed')); }
    });
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
    if (options.format === 'jpeg') { context.fillStyle = '#111923'; context.fillRect(0, 0, width, height); }
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => {
      let done = false;
      const finish = (value?: Blob | null) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); value && value.type === `image/${options.format}` ? resolve(value) : reject(new Error('Image encoding failed or cancelled')); };
      const abort = () => finish();
      const timer = setTimeout(() => finish(), 15000);
      signal?.addEventListener('abort', abort, { once: true });
      try { if (signal?.aborted) abort(); else canvas.toBlob(finish, `image/${options.format}`, 0.92); } catch { finish(); }
    });
    if (signal?.aborted || blob.size > MAX_IMAGE_BYTES) throw new Error('Image too large or cancelled');
    return { format: options.format, bytes: new Uint8Array(await blob.arrayBuffer()) };
  } finally { if (disposableImage) { disposableImage.onload = null; disposableImage.onerror = null; disposableImage.removeAttribute('src'); } URL.revokeObjectURL(url); if (disposableCanvas) { disposableCanvas.width = 0; disposableCanvas.height = 0; } }
}

/** Only translates a bounded, library-owned model. Never pass external ECharts options. */
export function toEChartsOption(model: ChartModel): SandboxChartOption {
  const safe = (v: number) => Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
  if (model.kind === 'pie' || model.kind === 'scatter') {
    if (model.series.length > 100) throw new Error('Invalid chart model');
    const base = { animation: false as const, color: colors, backgroundColor: 'transparent', textStyle: { color: '#f5f7fa' }, aria: { enabled: true, label: { enabled: true, description: model.description }, decal: { show: true } }, tooltip: { trigger: 'item' as const, renderMode: 'richText' as const, confine: true }, legend: { show: false } };
    if (model.kind === 'pie') {
      if (!model.slices?.length || model.slices.length > 100 || model.slices.some(s => !safe(s.value) || s.value < 0) || !model.slices.some(s => s.value > 0)) throw new Error('Invalid pie model');
      return { ...base, series: [{ type: 'pie', radius: '65%', stillShowZeroSum: false, label: { show: model.piePresentation?.showLabels ?? true, color: '#b8c1d1' }, data: model.slices.map((s, i) => ({ id: s.id, name: s.label, value: s.value, itemStyle: { color: colors[(model.series.find(series => series.id === s.id)?.paletteIndex ?? i) % colors.length] } })), emphasis: { disabled: true } }] };
    }
    if (model.series.reduce((n, s) => n + (s.points?.length ?? 0), 0) > 20_000 || model.series.some(s => !s.points || s.points.some(p => p.value.length !== 2 || p.value.some(v => !safe(v))))) throw new Error('Invalid scatter model');
    return { ...base, grid: { left: 65, right: 25, bottom: 55, top: 25 }, xAxis: { type: 'value', name: model.xLabel, nameLocation: 'middle', nameGap: 35, scale: true }, yAxis: { type: 'value', name: model.yLabel, nameLocation: 'middle', nameGap: 45, scale: true }, series: model.series.map((s, index) => ({ id: s.id, name: s.label, type: 'scatter', itemStyle: { color: colors[(s.paletteIndex ?? index) % colors.length] }, symbolSize: 9, data: s.points!.map(p => ({ id: p.id, name: p.label, value: p.value })), emphasis: { disabled: true } })) };
  }
  if (!['line', 'bar'].includes(model.kind) || model.series.length > 100 || model.categories.length * model.series.length > 20_000 || model.series.some(s => s.values.length !== model.categories.length || s.values.some(v => v !== null && (!Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER)))) throw new Error('Invalid chart model');
  // ECharts rich text parses {style|text} even in formatter output. Never let
  // source strings introduce rich-text tokens or additional control characters.
  const tooltipText = (text: string) => text.replace(/[{}]/g, char => char === '{' ? '｛' : '｝').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  const lineTooltip: NonNullable<TooltipComponentOption['formatter']> = params => {
    if (Array.isArray(params)) return '';
    const seriesIndex = params.seriesIndex, dataIndex = params.dataIndex;
    if (!Number.isInteger(seriesIndex) || !Number.isInteger(dataIndex)) return '';
    const source = model.series[seriesIndex!];
    const value = source?.values[dataIndex!];
    if (!source || typeof value !== 'number' || !Number.isFinite(value) || !model.categories[dataIndex!]) return '';
    const matches = model.series.filter(s => s.values[dataIndex!] === value)
      .sort((a, b) => a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return [tooltipText(source.valueLabels?.[dataIndex!] ?? model.categories[dataIndex!]!.label),
      ...matches.map(s => `${tooltipText(s.label)}: ${value}`)].join('\n');
  };
  return {
    animation: false,
    color: colors,
    backgroundColor: 'transparent',
    textStyle: { color: '#f5f7fa', fontFamily: 'sans-serif' },
    aria: { enabled: true, label: { enabled: true, description: model.description }, decal: { show: true } },
    grid: { left: 60, right: 18, top: 22, bottom: 52 },
    // No HTML interpolation, callbacks from documents, CSS strings or URL actions.
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, ...(model.kind === 'line' ? { formatter: lineTooltip } : {}) },
    legend: { show: false, selectedMode: false },
    xAxis: { type: 'category', name: model.xLabel, nameLocation: 'middle', nameGap: 40, data: model.categories.map(c => c.label), axisLabel: { color: '#b8c1d1', hideOverlap: true }, axisLine: { lineStyle: { color: '#535d70' } } },
    yAxis: { type: 'value', name: model.yLabel, nameLocation: 'middle', nameGap: 43, nameTextStyle: { color: '#b8c1d1', fontSize: 11 }, axisLabel: { color: '#b8c1d1' }, splitLine: { lineStyle: { color: '#384153' } } },
    series: model.series.map((s, index) => ({
      id: s.id, name: s.label, type: model.kind, itemStyle: { color: colors[(s.paletteIndex ?? index) % colors.length] },
      data: s.values.map((value, i) => value === null ? null : ({ value, name: s.valueLabels?.[i] ?? model.categories[i]?.label })), ...(model.kind === 'line' ? { connectNulls: false, smooth: false, showSymbol: true, symbol: ['circle', 'rect', 'triangle', 'diamond'][(s.paletteIndex ?? index) % 4], lineStyle: { type: (s.paletteIndex ?? index) % 2 ? 'dashed' : 'solid' } } : {}),
      emphasis: { disabled: true },
    } as BarSeriesOption | LineSeriesOption)),
  };
}

export function EChartsRenderer({ model, locale, unifyLegends = true, onVisibleModelChange, legendSelection }: { model: ChartModel; locale: string; unifyLegends?: boolean; onVisibleModelChange?: (model: ChartModel) => void; legendSelection?: { fieldId: string; referenceModel?: ChartModel; options: { value: string | number | boolean; label: string }[]; selected: (string | number | boolean)[]; disabled: boolean; onToggle: (value: string | number | boolean) => void } }) {
  const baseline = legendSelection?.referenceModel ?? model;
  const styledModel: ChartModel = { ...model, series: model.series.map((s, index) => { const found = baseline.series.findIndex(item => item.id === s.id); return { ...s, paletteIndex: found < 0 ? index : found }; }) };
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { setSelected([]); }, [model]);
  useEffect(() => {
    onVisibleModelChange?.(!legendSelection && selected.length ? { ...styledModel, series: styledModel.series.filter(s => selected.includes(s.id)), ...(model.slices ? { slices: model.slices.filter(s => selected.includes(s.id)) } : {}) } : styledModel);
  }, [model, baseline, selected, onVisibleModelChange, legendSelection]);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    if (!model.series.length) { setFailed(false); return; }
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
      const chartModel = !legendSelection && selected.length && model.kind !== 'pie'
        ? { ...styledModel, series: styledModel.series.filter(s => selected.includes(s.id)) }
        : styledModel;
      chart.setOption(toEChartsOption(chartModel), { notMerge: true });
      if (!legendSelection && selected.length) {
        if (model.kind === 'pie') {
          chart.setOption({ series: [{ type: 'pie', data: model.slices?.filter(s => selected.includes(s.id)).map(s => ({ id: s.id, name: s.label, value: s.value })) }] });
        }
      }
      if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(resize); observer.observe(node); }
      else window.addEventListener('resize', resize);
    } catch { setFailed(true); }
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); chart?.dispose(); };
  }, [model, baseline, locale, selected, Boolean(legendSelection)]);
  const compare = (a: string, b: string) => a.localeCompare(b, locale, { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
  return <>{failed && <p role="alert">{locale.startsWith('pt') ? 'Não foi possível renderizar o gráfico. Consulte a tabela.' : 'The chart could not be rendered. Use the table.'}</p>}<div ref={container} className="rds-sb-chart-surface" role="img" aria-label={model.description} />{(model.kind !== 'pie' || model.piePresentation?.showLegend !== false) && <div className="rds-sb-legend-scroll" role="region" aria-label={locale.startsWith('pt') ? 'Legenda do gráfico' : 'Chart legend'}><ul className="rds-sb-legend">{legendSelection && unifyLegends ? [...legendSelection.options].sort((a, b) => compare(a.label, b.label) || compare(JSON.stringify(a.value), JSON.stringify(b.value))).map(item => {
    const matches = baseline.series.flatMap((series, index) => series.dimensions?.[legendSelection.fieldId] === item.value ? [index] : []);
    return <li key={JSON.stringify(item.value)}><button type="button" title={matches.map(index => baseline.series[index]!.label).join('; ') || item.label} aria-label={matches.length ? `${item.label}: ${matches.map(index => baseline.series[index]!.label).join('; ')}` : item.label} disabled={legendSelection.disabled} aria-pressed={legendSelection.selected.includes(item.value)} onClick={() => legendSelection.onToggle(item.value)}><svg width="24" height="8" viewBox={`0 0 ${Math.max(1, matches.length) * 18} 8`} preserveAspectRatio="none" role="img" aria-label={matches.map(index => baseline.series[index]!.label).join('; ') || item.label}>{matches.map((index, i) => <g key={index}><title>{baseline.series[index]!.label}</title><line x1={i * 18} y1="4" x2={(i + 1) * 18} y2="4" stroke={colors[index % colors.length]} strokeWidth="3" strokeDasharray={model.kind === 'line' && index % 2 ? '4 2' : undefined} /><rect x={i * 18} y="0" width="18" height="8" fill="transparent" /></g>)}</svg>{item.label}</button></li>;
  }) : [...(legendSelection?.referenceModel?.series ?? model.series)].map(series => ({ series, index: baseline.series.findIndex(s => s.id === series.id) })).sort((a, b) => compare(a.series.label, b.series.label) || compare(a.series.id, b.series.id)).map(({ series, index }) => {
    const value = legendSelection && series.dimensions?.[legendSelection.fieldId];
    const filterable = value !== undefined && value !== null && legendSelection?.options.some(option => option.value === value);
    const description = filterable ? `${series.label} — ${locale.startsWith('pt') ? 'filtra todas as séries deste item' : 'filters all series for this item'}` : series.label;
    return <li key={series.id}><button type="button" title={description} aria-label={description} disabled={Boolean(legendSelection && (!filterable || legendSelection.disabled))} aria-pressed={filterable ? legendSelection!.selected.includes(value!) : selected.includes(series.id)} onClick={() => { if (filterable) legendSelection!.onToggle(value!); else if (!legendSelection) setSelected(selected.includes(series.id) ? selected.filter(id => id !== series.id) : [...selected, series.id]); }}><svg width="24" height="8" role="img" aria-label={series.label}><title>{series.label}</title><line x1="0" y1="4" x2="24" y2="4" stroke={colors[(index < 0 ? 0 : index) % colors.length]} strokeWidth="3" strokeDasharray={model.kind === 'line' && index % 2 ? '4 2' : undefined} /></svg>{series.label}</button></li>;
  })}</ul></div>}</>;
}
