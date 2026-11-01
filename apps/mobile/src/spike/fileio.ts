// Phase 1 spike (throwaway). Checks that expo-file-system's FileHandle can do the
// chunked reads/writes the file-transfer code needs: sequential write, sequential
// read, and a seek (random-access read), with content verification.
import { File, FileMode, Paths } from 'expo-file-system';

import { makeBase, makeChunk, verifyChunk, type ReadChunk, type Sink } from './transfer';

const now = () => performance.now();

export async function runFileIo(job: { sizeMB: number; chunkKB: number }) {
  const chunkBytes = job.chunkKB * 1024;
  const totalBytes = job.sizeMB * 1048576;
  const base = makeBase(chunkBytes);
  const file = new File(Paths.cache, `spike-${Date.now()}.bin`);
  file.create();

  try {
    // Sequential write (what receiving a file does). Time spent building the
    // chunk in JS is measured separately and subtracted.
    const writer = file.open(FileMode.WriteOnly);
    let written = 0;
    let index = 0;
    let buildMs = 0;
    const writeStart = now();
    while (written < totalBytes) {
      const length = Math.min(chunkBytes, totalBytes - written);
      const t = now();
      const chunk = makeChunk(base, index, length);
      buildMs += now() - t;
      await writer.writeBytes(chunk);
      written += length;
      index++;
    }
    writer.close();
    const writeMs = now() - writeStart - buildMs;

    const sizeOnDisk = file.size;

    // Sequential read (what sending a file does).
    const reader = file.open(FileMode.ReadOnly);
    reader.offset = 0;
    let readBytes = 0;
    let readIndex = 0;
    let bad = 0;
    const readStart = now();
    while (readBytes < totalBytes) {
      const data = await reader.readBytes(chunkBytes);
      if (!data.length) break;
      bad += verifyChunk(data, readIndex);
      readBytes += data.length;
      readIndex++;
    }
    const readMs = now() - readStart;

    // Seek: jump to a chunk in the middle and read just that one.
    const target = Math.floor(index / 2);
    reader.offset = target * chunkBytes;
    const middle = await reader.readBytes(chunkBytes);
    const seekOk = middle.length === chunkBytes && verifyChunk(middle, target) === 0;
    reader.close();

    const mb = totalBytes / 1048576;
    return {
      ok: bad === 0 && sizeOnDisk === totalBytes && readBytes === totalBytes && seekOk,
      totalMB: mb,
      chunks: index,
      sizeOnDisk,
      writeMBps: +(mb / (writeMs / 1000)).toFixed(1),
      readMBps: +(mb / (readMs / 1000)).toFixed(1),
      jsBuildMs: Math.round(buildMs),
      badChunks: bad,
      seekOk,
    };
  } finally {
    try {
      file.delete();
    } catch {}
  }
}

/** Writes a test file to disk, then returns a ReadChunk that reads it back through a FileHandle. */
export async function createSpikeFile(sizeMB: number, chunkKB: number) {
  const chunkBytes = chunkKB * 1024;
  const totalBytes = sizeMB * 1048576;
  const base = makeBase(chunkBytes);
  const file = new File(Paths.cache, `spike-src-${Date.now()}.bin`);
  file.create();

  const writer = file.open(FileMode.WriteOnly);
  for (let written = 0, index = 0; written < totalBytes; index++) {
    const length = Math.min(chunkBytes, totalBytes - written);
    await writer.writeBytes(makeChunk(base, index, length));
    written += length;
  }
  writer.close();

  const reader = file.open(FileMode.ReadOnly);
  const readChunk: ReadChunk = async (index, length) => {
    reader.offset = index * chunkBytes;
    return reader.readBytes(length);
  };

  return {
    readChunk,
    cleanup() {
      try {
        reader.close();
        file.delete();
      } catch {}
    },
  };
}

/** A file on disk that received chunks are appended to, like the app's receive-file writer. */
export function openFileSink(sync = false) {
  const file = new File(Paths.cache, `spike-dst-${Date.now()}.bin`);
  file.create();
  const handle = file.open(FileMode.WriteOnly);
  let closed = false;

  const sink: Sink = {
    write: (chunk) => handle.writeBytes(chunk),
    ...(sync ? { writeSync: (chunk: Uint8Array) => handle.writeBytesSync(chunk) } : {}),
    async close() {
      if (!closed) handle.close();
      closed = true;
    },
  };

  return {
    sink,
    sizeOnDisk: () => file.size,
    cleanup() {
      try {
        if (!closed) handle.close();
        file.delete();
      } catch {}
    },
  };
}
