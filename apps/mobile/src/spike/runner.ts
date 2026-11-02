// Phase 1 spike (throwaway). Polls spike/server.mjs for jobs, runs them and posts
// the results back, so tests can be re-run without rebuilding the app.
import { Platform } from 'react-native';
import * as webrtc from 'react-native-webrtc';

import { runFileIo } from './fileio';
import { getJson, postJson } from './http';
import { runBackpressure, runInterop, runLoopback, type PeerJob } from './peer';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const g = globalThis as any;

function describeEnvironment() {
  return {
    os: Platform.OS,
    osVersion: Platform.Version,
    reactNative: Platform.constants.reactNativeVersion,
    hermes: typeof g.HermesInternal !== 'undefined',
    bridgeless: !!g.RN$Bridgeless,
    fabric: !!g.nativeFabricUIManager,
    reactNativeWebrtc: require('react-native-webrtc/package.json').version,
    webrtcExports: Object.keys(webrtc).sort(),
    hasPerformanceNow: typeof performance?.now === 'function',
  };
}

type Job = Omit<Partial<PeerJob>, 'kind'> & { kind?: string };

async function runJob(job: Job) {
  switch (job.kind) {
    case 'env':
      return describeEnvironment();
    case 'loopback':
      return runLoopback(job as PeerJob);
    case 'interop':
      return runInterop(job as PeerJob);
    case 'backpressure':
      return runBackpressure();
    case 'fileio':
      return runFileIo({ sizeMB: job.sizeMB ?? 50, chunkKB: job.chunkKB ?? 50 });
    default:
      return { ok: false, error: `unknown job kind: ${job.kind}` };
  }
}

// Lets the transfer code report progress to the spike server without importing http.
g.__spikeLog = (line: string) => void postJson('/log', { who: Platform.OS, line }).catch(() => {});

export function startSpikeRunner() {
  // Fast Refresh re-evaluates this module; keep the guard on globalThis so only one loop ever runs.
  if (g.__spikeRunnerStarted) return;
  g.__spikeRunnerStarted = true;
  void loop();
}

async function loop() {
  const platform = Platform.OS;
  let greeted = false;

  for (;;) {
    try {
      if (!greeted) {
        await getJson(`/hello?who=${platform}`);
        greeted = true;
      }
      const job = await getJson<Job>(`/job?platform=${platform}`);
      if (job.kind) {
        await postJson('/log', { who: platform, line: `running ${JSON.stringify(job)}` });
        // A hung job must not wedge the loop: give every job a deadline.
        const result = await Promise.race([
          runJob(job),
          sleep(240000).then(() => ({ ok: false, error: 'job timeout after 240 s' })),
        ]).catch((error) => ({
          ok: false,
          error: String(error?.stack ?? error),
        }));
        await postJson('/result', { platform, job, result });
      }
    } catch {
      // server not running yet; try again
    }
    await sleep(1500);
  }
}
