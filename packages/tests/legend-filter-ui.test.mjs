import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Sandbox } from '@rds/sandbox-react';
import { EChartsRenderer, toEChartsOption } from '@rds/sandbox-echarts';
import { syntheticF1 } from './f1-fixture.mjs';

test('legend and facet share identity selections after filtered queries', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid', pretendToBeVisual: true });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true })) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get: () => 640 });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get: () => 340 });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: String(text).length * 7 }) });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const provider = syntheticF1(), query = provider.query, queries = [];
  provider.query = async (...args) => { queries.push(args[0]); return query(...args); };
  let chart, rendererProps;
  function Renderer(props) { chart = props.model; rendererProps = props; return createElement(EChartsRenderer, props); }
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await delay(120); }); };
  const legend = () => [...document.querySelectorAll('.rds-sb-legend button')];
  const click = async node => { assert.ok(node); await act(async () => node.click()); await settle(); };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider, ChartRenderer: Renderer }))); await settle();
    const facetFor = text => [...document.querySelectorAll('.rds-sb-quick-filter')].find(node => node.querySelector('summary').textContent.includes(text));
    const selectFacet = async (facetName, values) => {
      const facet = facetFor(facetName);
      if (!facet.open) await click(facet.querySelector('summary'));
      for (const value of values) {
        const label = [...facet.querySelectorAll('.rds-sb-facet label')].find(node => node.querySelector('span').textContent === value);
        assert.ok(label, `${facetName}: ${value}`);
        if (!label.querySelector('input').checked) await click(label.querySelector('input'));
      }
    };
    await selectFacet('Season', ['2024', '2025']);
    await selectFacet('Sessions', ['Race', 'Sprint']);
    const unify = [...document.querySelectorAll('label')].find(label => label.textContent === 'Unify events').querySelector('input');
    assert.equal(unify.checked, true);
    await click(unify);
    const selectedContext = queries.at(-1).filters.filter(f => f.fieldId !== 'driver');
    assert.deepEqual(queries.at(-1).filters.find(f => f.fieldId === 'season').values.sort(), ['2024', '2025']);
    assert.deepEqual(queries.at(-1).filters.find(f => f.fieldId === 'session').values.sort(), ['results', 'sprint']);
    assert.ok(legend().length >= 2);
    const countBeforeInvalid = queries.length;
    await act(async () => rendererProps.legendSelection.onToggle('not-a-facet-identity')); await settle();
    assert.equal(queries.length, countBeforeInvalid, 'unknown identities cannot mutate filters');
    const names = legend().slice(0, 2).map(button => button.textContent);
    const firstDriver = chart.series.find(series => series.label.includes(names[0])).dimensions.driver;
    const matchingIndices = chart.series.flatMap((series, index) => series.dimensions?.driver === firstDriver ? [index] : []);
    assert.ok(matchingIndices.length > 1, 'driver has multiple season/session series');
    const palette = toEChartsOption(chart).color;
    assert.deepEqual([...legend()[0].querySelectorAll('line')].map(line => line.getAttribute('stroke')), matchingIndices.map(index => palette[index % palette.length]));
    await click(legend()[0]);
    assert.deepEqual(queries.at(-1).filters.find(f => f.fieldId === 'driver').values, [firstDriver]);
    assert.deepEqual(queries.at(-1).filters.filter(f => f.fieldId !== 'driver'), selectedContext);
    assert.ok(legend().some(button => button.textContent === names[1]), 'unselected identity remains available after query');
    await click(legend().find(button => button.textContent === names[1]));
    assert.equal(queries.at(-1).filters.find(f => f.fieldId === 'driver').values.length, 2);
    await click(legend().find(button => button.textContent === names[0]));
    assert.equal(queries.at(-1).filters.find(f => f.fieldId === 'driver').values.length, 1);
    await click(legend().find(button => button.textContent === names[0]));
    const facet = facetFor('Drivers');
    await click(facet.querySelector('summary'));
    assert.equal(facet.querySelectorAll('.rds-sb-facet input:checked').length, 2);
    await click(facet.querySelector('.rds-sb-all'));
    assert.equal(queries.at(-1).filters.some(f => f.fieldId === 'driver'), false);
    assert.ok(legend().every(button => button.getAttribute('aria-pressed') === 'false'));
    const fromFacet = [...facet.querySelectorAll('.rds-sb-facet label')].find(label => label.querySelector('span').textContent === names[0]);
    await click(fromFacet.querySelector('input'));
    assert.equal(legend().find(button => button.textContent === names[0]).getAttribute('aria-pressed'), 'true');
    await click(legend().find(button => button.textContent === names[0]));
    assert.equal(queries.at(-1).filters.some(f => f.fieldId === 'driver'), false);
    await click(legend().find(button => button.textContent === names[1]));
    await click(legend().find(button => button.textContent === names[1]));
    assert.equal(queries.at(-1).filters.some(f => f.fieldId === 'driver'), false, 'removing last identity restores all');
    await click([...document.querySelectorAll('.rds-sb-mode button')].find(button => button.textContent === 'View mode'));
    assert.ok(legend().every(button => button.disabled), 'view mode cannot change filters');
    const countInViewMode = queries.length;
    await act(async () => rendererProps.legendSelection.onToggle(rendererProps.legendSelection.options[0].value)); await settle();
    assert.equal(queries.length, countInViewMode, 'callback is guarded even if renderer invokes it');
    await click([...document.querySelectorAll('.rds-sb-mode button')].find(button => button.textContent === 'Edit mode'));
    await click(document.querySelector('.rds-sb-advanced summary'));
    await click([...document.querySelectorAll('.rds-sb-advanced summary')].find(node => node.textContent === 'Add filter'));
    const choose = async (label, value) => {
      const select = [...document.querySelectorAll('.rds-sb-advanced label')].find(node => node.firstChild?.textContent === label).querySelector('select');
      await act(async () => { select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle();
    };
    await choose('Field', 'driver');
    await choose('Operator', 'contains');
    const input = [...document.querySelectorAll('.rds-sb-advanced label')].find(node => node.firstChild?.textContent === 'Contains literal text').querySelector('input');
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'ana'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); await settle();
    await click([...document.querySelectorAll('.rds-sb-advanced button')].find(button => button.textContent === 'Apply filter'));
    assert.equal(queries.at(-1).filters.find(f => f.fieldId === 'driver').op, 'contains');
    await click(legend().find(button => button.textContent === names[1]));
    assert.equal(queries.at(-1).filters.find(f => f.fieldId === 'driver').op, 'in', 'legend replaces advanced operator');
    await click(legend().find(button => button.textContent === names[1]));
    await click([...document.querySelectorAll('.rds-sb-chart-types button')].find(button => button.textContent === 'Scatter'));
    assert.equal(chart.kind, 'scatter');
    await click(legend()[0]);
    await click(legend()[1]);
    assert.equal(queries.at(-1).filters.find(f => f.fieldId === 'driver').values.length, 2);
    await click(legend()[0]);
    await click(legend()[1]);
    assert.equal(queries.at(-1).filters.some(f => f.fieldId === 'driver'), false);
    await click([...document.querySelectorAll('.rds-sb-chart-types button')].find(button => button.textContent === 'Pie'));
    assert.ok(legend().length >= 2);
    await click(legend()[0]);
    assert.equal(queries.at(-1).filters.find(f => f.fieldId === 'driver').values.length, 1);
    assert.ok(legend().length >= 2, 'pie keeps unselected identities');
    await click(legend()[1]);
    await click(legend()[0]);
    await click(legend()[1]);
    assert.equal(queries.at(-1).filters.some(f => f.fieldId === 'driver'), false);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  }
});
