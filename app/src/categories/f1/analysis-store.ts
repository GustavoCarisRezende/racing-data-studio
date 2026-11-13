import { assertAnalysisList, parseAnalysisDocument, parseModelDocument, parseSavedModelDocument, SandboxError } from '@rds/sandbox-contracts';
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
    if (['CONFLICT', 'REVISION_MISSING', 'INVALID_CONTRACT', 'LIMIT_EXCEEDED', 'UNSUPPORTED_VERSION'].includes(code)) throw new SandboxError(code as SandboxErrorCode, code);
    throw e;
  }
}
export function createF1AnalysisStore(invoke: Invoke): AnalysisStore {
  return {
    modelsV3: {
      documentVersion: 3,
      async list(signal) { const result = await call<unknown>(invoke, 'f1_models_v3_list', {}, signal); assertAnalysisList(result); return result; },
      async load(id, signal) { const doc = parseSavedModelDocument(await call<unknown>(invoke, 'f1_model_v3_load', { id }, signal), descriptor); if (doc.id !== id) throw new SandboxError('INVALID_CONTRACT', 'Identity mismatch'); return doc; },
      async save(document, expectedRevision, signal) {
        const parsed = parseSavedModelDocument(document, descriptor);
        if (parsed.revision !== expectedRevision) throw new SandboxError('CONFLICT', 'Revision mismatch');
        const saved = parseSavedModelDocument(await call<unknown>(invoke, 'f1_model_v3_save', { document: parsed, expectedRevision }, signal), descriptor);
        if (!saved.revision || JSON.stringify({ ...saved, revision: null }) !== JSON.stringify({ ...parsed, revision: null })) throw new SandboxError('INVALID_CONTRACT', 'Store changed model');
        return saved;
      },
      async delete({ id, expectedRevision }, signal) { await call<void>(invoke, 'f1_model_v3_delete', { id, expectedRevision }, signal); },
    },
    models: {
      documentVersion: 2,
      async list(signal) { const result = await call<unknown>(invoke, 'f1_models_list', {}, signal); assertAnalysisList(result); return result; },
      async load(id, signal) { const doc = parseModelDocument(await call<unknown>(invoke, 'f1_model_load', { id }, signal), descriptor); if (doc.id !== id) throw new SandboxError('INVALID_CONTRACT', 'Identity mismatch'); return doc; },
      async save(document, expectedRevision, signal) {
        const parsed = parseModelDocument(document, descriptor);
        if (parsed.revision !== expectedRevision) throw new SandboxError('CONFLICT', 'Revision mismatch');
        const saved = parseModelDocument(await call<unknown>(invoke, 'f1_model_save', { document: parsed, expectedRevision }, signal), descriptor);
        if (!saved.revision || JSON.stringify({ ...saved, revision: null }) !== JSON.stringify({ ...parsed, revision: null })) throw new SandboxError('INVALID_CONTRACT', 'Store changed model');
        return saved;
      },
      async delete({ id, expectedRevision }, signal) { await call<void>(invoke, 'f1_model_delete', { id, expectedRevision }, signal); },
    },
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
