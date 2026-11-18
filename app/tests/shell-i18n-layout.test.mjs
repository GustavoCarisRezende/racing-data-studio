import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { messages } from '../src/i18n/messages.ts';

test('About explains the real workflow, category contribution, data limits and licenses in PT/EN', () => {
  const cases = {
    'en-US': {
      aboutPurposeText: [/drivers/, /teams/, /seasons/, /charts/, /tables/, /filters/, /cumulative/, /CSV/, /SVG/, /PNG/],
      aboutStartText: [/Formula 1/, /Manage synchronizations/, /manually import/, /catalog/, /Sandbox/, /save a reusable model/],
      aboutDataText: [/stored locally/, /network access/, /remote season catalog/, /gaps/, /not official classifications/],
      aboutContributeText: [/not installed automatically/, /independent SQLite storage/, /Sandbox data provider/, /app\/src\/categories/, /GitHub/],
      aboutLicensesText: [/Apache-2\.0/, /CC BY-NC-SA 4\.0/, /non-commercial/, /attribution/, /source terms/],
    },
    'pt-BR': {
      aboutPurposeText: [/pilotos/, /equipes/, /temporadas/, /gráficos/, /tabelas/, /filtros/, /acumulados/, /CSV/, /SVG/, /PNG/],
      aboutStartText: [/Fórmula 1/, /Gerenciar sincronizações/, /manualmente/, /catálogo/, /Sandbox/, /salvar um modelo reutilizável/],
      aboutDataText: [/armazenados localmente/, /rede/, /catálogo remoto/, /lacunas/, /não classificações oficiais/],
      aboutContributeText: [/não são instaladas automaticamente/, /SQLite independentes/, /provider de dados/, /app\/src\/categories/, /GitHub/],
      aboutLicensesText: [/Apache-2\.0/, /CC BY-NC-SA 4\.0/, /sem fins comerciais/, /créditos/, /termos da fonte/],
    },
  };
  for (const [locale, sections] of Object.entries(cases)) {
    const copy = messages[locale];
    for (const [key, patterns] of Object.entries(sections)) {
      assert.ok(copy[key], `${locale} missing ${key}`);
      for (const pattern of patterns) assert.match(copy[key], pattern, `${locale} ${key} should mention ${pattern}`);
      const sentenceEndings = copy[key].match(/[.!?](?=\s+[A-ZÀ-Þ]|$)/g) ?? [];
      assert.ok(sentenceEndings.length <= 2, `${locale} ${key} should stay concise`);
    }
  }
});

test('all F1 tabs share the sandbox shell canvas and tab geometry', async () => {
  const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  const f1Screen = await readFile(new URL('../src/categories/f1/index.tsx', import.meta.url), 'utf8');
  assert.match(css, /\.content:has\(\.f1-screen\)\s*\{\s*width:calc\(100% - 64px\);\s*max-width:1800px;/);
  assert.match(css, /\.f1-screen \.f1-tab-scroll/);
  assert.match(css, /\.f1-screen \.f1-nav button/);
  assert.doesNotMatch(css, /:has\(\.f1-sandbox\)/);
  assert.match(f1Screen, /<h1>\{t\('f1Heading'\)\}<\/h1>/);
  assert.match(f1Screen, /className="f1-analysis-description" aria-hidden="true"\s*\/>/);
  assert.match(css, /\.f1-analysis-description\s*\{\s*height:20px;/);
  assert.doesNotMatch(f1Screen, /<h1>\{view === 'sandbox'/);
  assert.match(f1Screen, /snapshotError\?\.operation === 'delete'.*role="alert"/);
  assert.match(f1Screen, /snapshotError\?\.snapshotId === snapshot\.id && snapshotError\.operation === 'rename'/);
  assert.match(f1Screen, /className="snapshot-inline-error"[^>]*role="alert"/);
});

test('snapshot operation errors have localized inline copy in both supported languages', () => {
  for (const locale of ['en-US', 'pt-BR']) {
    const copy = messages[locale];
    for (const key of ['activeCannotDelete', 'pinnedCannotDelete', 'deleteCheckFailed', 'snapshotNameConflict', 'snapshotNameInvalid', 'snapshotNotFound']) {
      assert.ok(copy[key], `${locale} missing ${key}`);
    }
  }
});

test('short desktop windows use a conditional centered category title without cropping the workspace', async () => {
  const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  const shell = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(shell, /active \? ' app-shell--category'/);
  assert.match(shell, /active && <span className="masthead-category" aria-hidden="true">\{t\(active\.name\)\}/);
  assert.match(css, /\.masthead-category\s*\{\s*display:none;/);
  assert.match(shell, /active && compactLayout \? ' app-shell--compact'/);
  assert.match(css, /@media \(min-width:900px\)/);
  assert.doesNotMatch(css, /max-height:850px/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);
  assert.match(css, /\.app-shell--compact \.f1-screen>h1\s*\{[^}]*clip-path:inset\(50%\)/);
  assert.match(css, /\.app-shell--compact \.f1-analysis-description\s*\{\s*display:none;/);
  assert.match(css, /\.f1-sandbox \.rds-sb-chart-surface\s*\{\s*height:clamp\(220px,calc\(100dvh - 420px\),310px\)/);
  assert.doesNotMatch(css, /\.f1-sandbox[^}]*overflow:hidden/);
});
