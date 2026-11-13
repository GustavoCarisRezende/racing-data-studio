export function Icon({ name }: { name: 'line' | 'bar' | 'table' | 'pie' | 'scatter' | 'dataset' | 'filter' | 'save' | 'export' | 'compare' | 'models' }) {
  const paths = {
    line: 'M3 17 9 10l5 4 7-10M3 3v18h18',
    bar: 'M4 20V10h4v10m3 0V4h4v16m3 0v-7h4v7',
    table: 'M3 4h18v16H3zM3 9h18M9 4v16M15 4v16',
    pie: 'M12 3v9h9A9 9 0 0 0 12 3ZM8 4a9 9 0 1 0 12 12H8Z',
    scatter: 'M3 3v18h18M7 15h1m3-7h1m3 5h1m3-8h1m-9 12h1',
    models: 'M4 4h16v16H4zM4 9h16M9 9v11',
    dataset: 'm12 3 10 5-10 5L2 8Zm-9 9 9 5 9-5m-18 5 9 5 9-5',
    filter: 'M3 6h18M6 12h12M9 18h6',
    save: 'M4 3h14l3 3v15H3V3h1Zm3 0v7h10V3M7 21v-7h10v7',
    export: 'M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5',
    compare: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
  };
  return <svg className="rds-sb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
