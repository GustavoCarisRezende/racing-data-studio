import { assertAnalysisList, parseAnalysisDocument, SandboxError } from '@rds/sandbox-contracts';
import type { AnalysisDocument, AnalysisStore, SandboxErrorCode } from '@rds/sandbox-contracts';
import { descriptor } from './analysis-provider';

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new SandboxError('ABORTED', 'Aborted'); };
async function call<T>(invoke: Invoke, command: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  abort(signal);
  try { const value = await invoke<T>(command, args); abort(signal); return value; }
  catch (e) {
    if (e instanceof SandboxError) throw e;
    const code = String(e);
    if (['CONFLICT', 'REVISION_MISSING', 'INVALID_CONTRACT', 'LIMIT_EXCEEDED'].includes(code)) throw new SandboxError(code as SandboxErrorCode, code);
    throw e;
  }
}
export function createF1AnalysisStore(invoke: Invoke): AnalysisStore {
  return {
    async list(signal) { const result = await call<unknown>(invoke, 'f1_analyses_list', {}, signal); assertAnalysisList(result); return result; },
    async load(id, signal) { const result = await call<unknown>(invoke, 'f1_analysis_load', { id }, signal); const document = parseAnalysisDocument(result, descriptor); if (document.id !== id) throw new SandboxError('INVALID_CONTRACT', 'Identity mismatch'); return document; },
    async save(document: AnalysisDocument, expectedRevision, signal) {
      const parsed = parseAnalysisDocument(document, descriptor);
      if (parsed.revision !== expectedRevision) throw new SandboxError('CONFLICT', 'Revision mismatch');
      const result = await call<unknown>(invoke, 'f1_analysis_save', { document: parsed, expectedRevision }, signal);
      const saved = parseAnalysisDocument(result, descriptor);
      if (!saved.revision || JSON.stringify({ ...saved, revision: null }) !== JSON.stringify({ ...parsed, revision: null })) throw new SandboxError('INVALID_CONTRACT', 'Store changed document');
      return saved;
    },
  };
}
