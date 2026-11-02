import { spawn } from 'node:child_process';

/**
 * Drives ffsubsync (https://github.com/smacke/ffsubsync) through its library API so the
 * outcome is machine-readable instead of scraped from log text.
 */
const RUNNER = [
  'import json, sys',
  'from ffsubsync.ffsubsync import make_parser, run',
  'def progress(info):',
  '    if info.fraction is not None:',
  '        sys.stdout.write("SUBSARR_PROGRESS %.4f\\n" % info.fraction)',
  '        sys.stdout.flush()',
  'result = run(make_parser().parse_args(sys.argv[1:]), progress_handler=progress)',
  'sys.stdout.write("SUBSARR_RESULT " + json.dumps(result, default=str) + "\\n")',
].join('\n');

export interface FfsubsyncRequest {
  python: string;
  /** Video file (audio voice-activity reference) or a correctly timed subtitle file. */
  reference: string;
  referenceIsAudio: boolean;
  input: string;
  output: string;
  allowSplits: boolean;
  maxOffsetSeconds: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface FfsubsyncOutcome {
  synced: boolean;
  offsetSeconds: number;
  framerateScaleFactor: number;
}

export class SyncEngineUnavailableError extends Error {}

export function buildFfsubsyncArgs(request: FfsubsyncRequest): string[] {
  const maxOffset = String(request.maxOffsetSeconds);
  return [
    '-c',
    RUNNER,
    request.reference,
    '-i',
    request.input,
    '-o',
    request.output,
    '--encoding',
    'utf-8',
    '--output-encoding',
    'utf-8',
    '--max-offset-seconds',
    maxOffset,
    // Bulk-safety gate: an untrustworthy alignment is reported instead of written.
    '--skip-sync-on-low-quality',
    '--quality-max-offset-seconds',
    maxOffset,
    ...(request.referenceIsAudio ? ['--vad', 'webrtc'] : []),
    // Optional-value flag; keep it last so it never consumes another argument.
    ...(request.allowSplits ? ['--split-penalty'] : []),
  ];
}

export function parseFfsubsyncResult(line: string): FfsubsyncOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error('ffsubsync returned an unreadable result');
  }
  if (typeof parsed !== 'object' || parsed === null)
    throw new Error('ffsubsync returned an unreadable result');
  const result = parsed as Record<string, unknown>;
  if (result.retval !== 0)
    throw new Error(`ffsubsync failed with code ${String(result.retval)}`);
  const synced = result.sync_was_successful === true;
  const offset = result.offset_seconds;
  const scale = result.framerate_scale_factor;
  if (!synced) return { synced, offsetSeconds: 0, framerateScaleFactor: 1 };
  if (
    typeof offset !== 'number' ||
    !Number.isFinite(offset) ||
    typeof scale !== 'number' ||
    !Number.isFinite(scale) ||
    scale <= 0
  )
    throw new Error('ffsubsync returned an incomplete result');
  return { synced, offsetSeconds: offset, framerateScaleFactor: scale };
}

function describeFailure(stderr: string, code: number | null): string {
  if (/No module named '?ffsubsync/.test(stderr))
    throw new SyncEngineUnavailableError(
      'ffsubsync is not installed for the configured Python (SUBSYNC_SYNC_PYTHON)',
    );
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = lines.slice(-3).join(' | ').slice(-500);
  return `ffsubsync failed (${code === null ? 'killed' : `exit ${code}`})${detail ? `: ${detail}` : ''}`;
}

export function runFfsubsync(
  request: FfsubsyncRequest,
): Promise<FfsubsyncOutcome> {
  return new Promise((resolve, reject) => {
    request.signal?.throwIfAborted();
    const child = spawn(request.python, buildFfsubsyncArgs(request), {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // A process group lets cancellation also stop the ffmpeg decoder ffsubsync spawns.
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        NO_COLOR: '1',
        TERM: 'dumb',
      },
    });
    let stdout = '';
    let stderr = '';
    let resultLine: string | undefined;
    let failure: Error | undefined;
    const kill = () => {
      try {
        if (process.platform !== 'win32' && child.pid)
          process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const stop = (error: Error) => {
      failure ??= error;
      kill();
    };
    const abort = () => {
      const reason: unknown = request.signal?.reason;
      stop(
        reason instanceof Error ? reason : new Error('Subtitle sync cancelled'),
      );
    };
    const timer = setTimeout(
      () => stop(new Error('Subtitle sync timed out')),
      request.timeoutMs,
    );
    request.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      let newline = stdout.indexOf('\n');
      while (newline >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (line.startsWith('SUBSARR_PROGRESS ')) {
          const fraction = Number(line.slice(17));
          if (Number.isFinite(fraction))
            request.onProgress?.(Math.min(1, Math.max(0, fraction)));
        } else if (line.startsWith('SUBSARR_RESULT ')) {
          resultLine = line.slice(15);
        }
        newline = stdout.indexOf('\n');
      }
      if (stdout.length > 65_536) stdout = stdout.slice(-65_536);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-16_384);
    });
    child.once('error', (error: NodeJS.ErrnoException) => {
      failure ??=
        error.code === 'ENOENT'
          ? new SyncEngineUnavailableError(
              `Python executable "${request.python}" was not found; install ffsubsync or set SUBSYNC_SYNC_PYTHON`,
            )
          : error;
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
      try {
        if (failure) throw failure;
        if (code !== 0 || resultLine === undefined)
          throw new Error(describeFailure(stderr, code));
        resolve(parseFfsubsyncResult(resultLine));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
