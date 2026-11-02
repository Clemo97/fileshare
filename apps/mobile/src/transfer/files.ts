// Picking files to send, reading them in chunks, and writing received files to disk.
//
// expo-file-system and expo-sharing are loaded with require() inside the functions. The release
// build pre-renders the app on Node, where native-only modules must not run at import time
// (HANDOFF G2).
import type { File as ExpoFile } from 'expo-file-system';

import type { FileMeta } from '@/features/sample-data';

import { CHUNK_BYTES, type ReadChunk, type Sink } from './protocol';

/* eslint-disable @typescript-eslint/no-require-imports */
const fileSystem = () => require('expo-file-system') as typeof import('expo-file-system');
const sharing = () => require('expo-sharing') as typeof import('expo-sharing');
/* eslint-enable @typescript-eslint/no-require-imports */

export type PickedFile = FileMeta & { file: ExpoFile };

/** Opens the system file picker. Returns null if the user cancels. */
export async function pickFiles(): Promise<PickedFile[] | null> {
  const { File } = fileSystem();
  const picked = await File.pickFileAsync({ multipleFiles: true });
  if (picked.canceled || picked.result.length === 0) return null;
  return picked.result.map((file) => ({
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    file,
  }));
}

/** Reads a file in CHUNK_BYTES pieces, in order, without loading it into memory. */
export function openSource(picked: PickedFile) {
  const { FileMode } = fileSystem();
  const handle = picked.file.open(FileMode.ReadOnly);
  const readChunk: ReadChunk = async (index, length) => {
    handle.offset = index * CHUNK_BYTES;
    return handle.readBytes(length);
  };
  return {
    readChunk,
    close() {
      try {
        handle.close();
      } catch {}
    },
  };
}

/** A name that is safe to use as a file name, whatever the other device claims it is. */
export function safeFileName(name: string) {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '_')
    .trim();
  return (cleaned || 'file').slice(0, 120);
}

/**
 * Where a received file goes: its own folder in the app's cache (so the name the user sees when
 * saving is clean), written with synchronous writes. The system may clear the cache when
 * storage is low, which is why a received file should be saved or shared once it arrives.
 */
export function openSink(name: string) {
  const { Directory, File, FileMode, Paths } = fileSystem();
  const folder = new Directory(
    Paths.cache,
    'received',
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  );
  folder.create({ intermediates: true, idempotent: true });
  const file = new File(folder, safeFileName(name));
  file.create();
  const handle = file.open(FileMode.WriteOnly);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      handle.close();
    } catch {}
  };
  const sink: Sink = { writeSync: (chunk) => handle.writeBytesSync(chunk), close };

  return {
    sink,
    uri: file.uri,
    /** Throws away a partly received file. */
    discard() {
      close();
      try {
        folder.delete();
      } catch {}
    },
  };
}

/** Opens the share sheet so the user can save or open a received file. */
export async function shareReceived(uri: string, mimeType: string) {
  const Sharing = sharing();
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available here.');
  await Sharing.shareAsync(uri, mimeType ? { mimeType } : undefined);
}

/**
 * Development only: writes a test file whose byte at position p is (p * 131 + 17) & 255, so a
 * received copy can be checked byte for byte. Used by mobile://home?sendTest=<MB>,<MB>
 */
export function createTestFile(sizeMB: number, label: string): PickedFile {
  const { Directory, File, FileMode, Paths } = fileSystem();
  const folder = new Directory(Paths.cache, 'test-files', Date.now().toString(36));
  folder.create({ intermediates: true, idempotent: true });
  const name = `test-${label}-${sizeMB}MB.bin`;
  const file = new File(folder, name);
  file.create();

  // 50 KB is a multiple of the 256-byte pattern, so every full chunk is identical.
  const chunk = new Uint8Array(CHUNK_BYTES);
  for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 131 + 17) & 255;

  const total = Math.round(sizeMB * 1048576);
  const handle = file.open(FileMode.WriteOnly);
  for (let written = 0; written < total; written += chunk.length) {
    handle.writeBytesSync(chunk.subarray(0, Math.min(chunk.length, total - written)));
  }
  handle.close();

  return { name, size: total, mimeType: 'application/octet-stream', file };
}
