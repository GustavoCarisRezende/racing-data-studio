import type { ExportArtifact, ImageExportArtifact } from '@rds/sandbox-contracts';

/** Invoker is injected for tests; the native command, not the frontend, chooses each path. */
export function createTextExporter(invoke: (command: string, args: { kind: string; content: string }) => Promise<boolean>) {
  return async (files: ExportArtifact[], signal?: AbortSignal) => {
    if (files.length !== 2 || files[0]?.mediaType !== 'text/csv;charset=utf-8' || files[1]?.mediaType !== 'application/json') throw { code: 'INVALID_EXPORT' };
    if (files.some(file => new TextEncoder().encode(file.text).length > 16 * 1024 * 1024)) throw { code: 'EXPORT_TOO_LARGE' };
    for (let i = 0; i < files.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const saved = await invoke('f1_export_text', { kind: i === 0 ? 'csv' : 'manifest', content: files[i]!.text });
        if (!saved) throw { code: 'EXPORT_CANCELLED' };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error) throw error;
        throw { code: typeof error === 'string' && /^EXPORT_[A-Z_]+$/.test(error) ? error : 'EXPORT_FAILED' };
      }
    }
  };
}

export function createImageExporter(invoke: (command: string, args: { kind: string; content: string }) => Promise<boolean>) {
  return async (file: ImageExportArtifact, signal?: AbortSignal) => {
    if (!['svg', 'png', 'jpeg'].includes(file.format) || !(file.bytes instanceof Uint8Array) || file.bytes.length === 0 || file.bytes.length > 8 * 1024 * 1024) throw { code: 'INVALID_EXPORT' };
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const pieces: string[] = [];
    // Multiple of three: concatenating chunks preserves base64 encoding.
    for (let start = 0; start < file.bytes.length; start += 0x6000) {
      const part = file.bytes.subarray(start, start + 0x6000);
      pieces.push(btoa(Array.from(part, byte => String.fromCharCode(byte)).join('')));
    }
    try {
      const saved = await invoke('f1_export_text', { kind: file.format, content: pieces.join('') });
      if (!saved) throw { code: 'EXPORT_CANCELLED' };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) throw error;
      throw { code: typeof error === 'string' && /^EXPORT_[A-Z_]+$/.test(error) ? error : 'EXPORT_FAILED' };
    }
  };
}
