import { readFile } from 'node:fs/promises';
import { createMemoryProvider, createMemoryStore } from '../examples/memory-provider.mjs';
export const descriptor = JSON.parse(await readFile(new URL('../fixtures/orchard.dataset.json', import.meta.url), 'utf8'));
export const rows = JSON.parse(await readFile(new URL('../fixtures/orchard.rows.json', import.meta.url), 'utf8'));
export function fixture() { return { provider: createMemoryProvider(descriptor, rows), store: createMemoryStore(descriptor), descriptor: structuredClone(descriptor) }; }
export async function resolve(provider) { return provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] }); }
