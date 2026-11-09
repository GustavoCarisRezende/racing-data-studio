/** JSON-only wire protocol. No category, storage, renderer or transport assumptions. */
export const PROTOCOL_VERSION = 1 as const;
export const DOCUMENT_VERSION = 1 as const;
export type Scalar = string | number | boolean | null;
export type PhysicalType = 'string' | 'boolean' | 'integer' | 'decimal' | 'date' | 'datetime';
export type Aggregation = 'sum' | 'mean' | 'min' | 'max' | 'count' | 'countDistinct';
export type ChartKind = 'table' | 'line' | 'bar';
export type FilterOperator = 'in' | 'range' | 'contains' | 'isNull' | 'isNotNull';
/** Literal text, optionally localized by the provider. Keys never depend on locale. */
export interface LocalizedText { fallback: string; translations?: Record<string, string> }
export interface FieldDescriptor {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  type: PhysicalType;
  role: 'dimension' | 'measure';
  analyticalType: 'nominal' | 'ordinal' | 'quantitative' | 'temporal';
  nullable: boolean;
  unit?: string;
  filters: FilterOperator[];
  /** Required for line axes; provider sorts by the underlying value, not label. */
  ordered: boolean;
  /** Result column containing display labels; IDs remain the grouped values. */
  labelField?: string;
  /** Localized labels for fixed codes; grouping and filters retain the original value. */
  valueLabels?: { value: Exclude<Scalar, null>; label: LocalizedText }[];
  availability: 'available' | 'partial' | 'unavailable';
}
export interface MetricDescriptor {
  id: string;
  label: LocalizedText;
  description: LocalizedText;
  fieldId: string;
  unit?: string;
  aggregations: Aggregation[];
  defaultAggregation: Aggregation;
  /** Empty means no grouping allowed. Every query dimension must be listed. */
  groupableBy: string[];
  /** Always retained in grouping, e.g. a campaign that must never be summed away. */
  requiredDimensions?: string[];
  nullPolicy: 'ignore' | 'propagate';
  additive: boolean;
  supportsRunningSum: boolean;
}
export interface SourceAttribution {
  name: string;
  attribution: string;
  license: string;
  /** Informational only: the library never fetches or opens these URLs. */
  url?: string;
}
export interface DatasetSummary { id: string; label: LocalizedText; description: LocalizedText }
export interface DatasetDescriptor extends DatasetSummary {
  protocolVersion: 1;
  schemaVersion: string;
  semanticVersion: string;
  grain: LocalizedText;
  fields: FieldDescriptor[];
  metrics: MetricDescriptor[];
  sources: SourceAttribution[];
  limitations: LocalizedText[];
  /** Optional presentation hints. They do not alter query or persistence semantics. */
  presentation?: {
    primaryFilterFieldId?: string;
    filters?: { fieldId: string; label?: LocalizedText }[];
    defaultVisualization?: VisualizationSpec;
    defaultFilters?: Filter[];
    views?: { id: string; label: LocalizedText; filters: Filter[]; visualization: VisualizationSpec }[];
  };
  capabilities: {
    charts: ChartKind[];
    maxDimensions: number;
    maxRows: number;
    maxSeries: number;
    /** Generic optional grouping dimension, e.g. collection year or experiment. */
    comparisonDimensions: string[];
    runningSum: boolean;
    /** Query returns a bounded complete result or an explicit error, never a sample. */
    completeGroupedQueries: boolean;
  };
}
export type Filter =
  | { fieldId: string; op: 'in'; values: Exclude<Scalar, null>[] }
  | { fieldId: string; op: 'range'; min?: string | number; max?: string | number }
  | { fieldId: string; op: 'contains'; value: string }
  | { fieldId: string; op: 'isNull' | 'isNotNull' };
export interface RevisionReference {
  partitionId: string;
  revisionId: string;
  sourceDataAt: string | null;
  storedAt: string;
}
export interface SelectionRequest {
  protocolVersion: 1;
  datasetId: string;
  policy: 'latest' | 'pinned';
  /** Provider-defined partition IDs (not SQL, paths or URLs). Empty = local scope. */
  partitionIds: string[];
  revisions?: RevisionReference[];
}
export interface ResolvedSelection {
  protocolVersion: 1;
  datasetId: string;
  token: string;
  revisions: RevisionReference[];
  transformationVersion: string;
}
export interface MetricSelection { metricId: string; aggregation: Aggregation }
export interface QueryRequest {
  protocolVersion: 1;
  requestId: string;
  datasetId: string;
  schemaVersion: string;
  semanticVersion: string;
  selection: ResolvedSelection;
  dimensions: string[];
  metrics: MetricSelection[];
  /** AND between filters, OR inside an 'in' filter; all applied BEFORE windows. */
  filters: Filter[];
  orderBy: { fieldId: string; direction: 'asc' | 'desc' }[];
  window?: {
    kind: 'runningSum';
    metricId: string;
    orderBy: string;
    partitionBy: string[];
    /** Explicitly not a full-season cumulative if population filters excluded rows. */
    scope: 'filteredSelection';
  };
  limit: number;
}
export interface ResultColumn {
  id: string;
  label: LocalizedText;
  type: PhysicalType;
  unit?: string;
}
export interface ResultRow { id: string; values: Record<string, Scalar> }
export interface QueryWarning { code: string; message: LocalizedText }
export interface QueryResult {
  protocolVersion: 1;
  requestId: string;
  selectionToken: string;
  columns: ResultColumn[];
  rows: ResultRow[];
  /** Library refuses charts/exports for incomplete results. */
  complete: boolean;
  totalRows: number | null;
  warnings: QueryWarning[];
}
export interface FacetRequest {
  protocolVersion: 1;
  datasetId: string;
  selection: ResolvedSelection;
  fieldId: string;
  filters: Filter[];
  search: string;
  cursor?: string;
  limit: number;
}
export interface FacetPage {
  values: { value: Exclude<Scalar, null>; label: string; count?: number }[];
  nextCursor?: string;
}
export interface DescribeDatasetRequest { datasetId: string; locale: string }
export interface SandboxDataProvider {
  listDatasets(signal?: AbortSignal): Promise<DatasetSummary[]>;
  describeDataset(request: DescribeDatasetRequest, signal?: AbortSignal): Promise<DatasetDescriptor>;
  resolveSelection(request: SelectionRequest, signal?: AbortSignal): Promise<ResolvedSelection>;
  query(request: QueryRequest, signal?: AbortSignal): Promise<QueryResult>;
  /** Filters exclude this facet's own field; pagination must be stable per selection. */
  facet?(request: FacetRequest, signal?: AbortSignal): Promise<FacetPage>;
}
export interface VisualizationSpec {
  kind: ChartKind;
  x: string;
  metric: MetricSelection;
  series: string | null;
  comparison: string | null;
  runningSum: boolean;
}
export interface AnalysisDocument {
  documentVersion: 1;
  id: string;
  /** Optimistic revision owned by store; new documents start with null. */
  revision: string | null;
  title: string;
  datasetId: string;
  datasetSchemaVersion: string;
  datasetSemanticVersion: string;
  selection: ResolvedSelection;
  visualization: VisualizationSpec;
  filters: Filter[];
  createdAt: string;
  updatedAt: string;
}
export interface AnalysisSummary { id: string; revision: string; title: string; updatedAt: string }
export interface AnalysisStore {
  list(signal?: AbortSignal): Promise<AnalysisSummary[]>;
  /** Return unknown so imported/stored documents MUST be validated at the boundary. */
  load(id: string, signal?: AbortSignal): Promise<unknown>;
  save(document: AnalysisDocument, expectedRevision: string | null, signal?: AbortSignal): Promise<AnalysisDocument>;
}
export interface ExportArtifact { name: string; mediaType: string; text: string }
export interface SandboxHostServices {
  /** Native chooser/write remains the host's responsibility. No arbitrary fs in UI. */
  exportFiles?: (files: ExportArtifact[], signal?: AbortSignal) => Promise<void>;
}
export type SandboxErrorCode = 'INVALID_CONTRACT' | 'INVALID_QUERY' | 'UNSUPPORTED_VERSION' |
  'INCOMPLETE_RESULT' | 'LIMIT_EXCEEDED' | 'REVISION_MISSING' | 'CONFLICT' | 'ABORTED';
export class SandboxError extends Error {
  constructor(public readonly code: SandboxErrorCode, message: string, public readonly fieldId?: string) {
    super(message);
    this.name = 'SandboxError';
  }
}
export { assertDataset, assertCatalog, assertAnalysisList, assertSelection, assertQuery, assertResult, assertVisualization, parseAnalysisDocument, assertFacetPage, compareDecimal, isScalarOfType } from './validation.js';
