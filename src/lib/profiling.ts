// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

export const TRACE_FILE_ENV = "NEMOCLAW_TRACE_FILE";
export const TRACE_DIR_ENV = "NEMOCLAW_TRACE_DIR";

export type TraceArgs = Record<string, unknown>;

export interface ChromeTraceEvent {
  name: string;
  cat: string;
  ph: "X";
  ts: number;
  dur: number;
  pid: number;
  tid: number;
  args?: TraceArgs;
}

export interface ChromeTraceData {
  traceEvents: ChromeTraceEvent[];
}

export interface Span {
  end(args?: TraceArgs): void;
}

interface Clock {
  nowMicroseconds(): number;
}

interface TracerOptions {
  enabled?: boolean;
  traceFile?: string;
  clock?: Clock;
  pid?: number;
  tid?: number;
}

export interface Tracer {
  readonly enabled: boolean;
  startSpan(name: string, args?: TraceArgs): Span;
  withSpan<T>(name: string, fn: () => T, args?: TraceArgs): T;
  toChromeTrace(): ChromeTraceData;
  flush(): void;
}

const noopSpan: Span = {
  end: () => {},
};

class PerformanceClock implements Clock {
  nowMicroseconds(): number {
    return Math.round((performance.timeOrigin + performance.now()) * 1000);
  }
}

class NoopTracer implements Tracer {
  readonly enabled = false;

  startSpan(_name: string, _args?: TraceArgs): Span {
    return noopSpan;
  }

  withSpan<T>(_name: string, fn: () => T, _args?: TraceArgs): T {
    return fn();
  }

  toChromeTrace(): ChromeTraceData {
    return { traceEvents: [] };
  }

  flush(): void {}
}

class RecordingSpan implements Span {
  private ended = false;

  constructor(
    private readonly tracer: RecordingTracer,
    private readonly name: string,
    private readonly args: TraceArgs | undefined,
    private readonly startMicroseconds: number,
  ) {}

  end(args?: TraceArgs): void {
    if (this.ended) return;
    this.ended = true;
    const endMicroseconds = this.tracer.nowMicroseconds();
    this.tracer.record({
      name: this.name,
      cat: "nemoclaw",
      ph: "X",
      ts: this.startMicroseconds,
      dur: Math.max(0, endMicroseconds - this.startMicroseconds),
      pid: this.tracer.pid,
      tid: this.tracer.tid,
      args: mergeArgs(this.args, args),
    });
  }
}

class RecordingTracer implements Tracer {
  readonly enabled = true;
  readonly pid: number;
  readonly tid: number;
  private readonly events: ChromeTraceEvent[] = [];
  private readonly clock: Clock;
  private readonly traceFile: string | undefined;

  constructor(options: TracerOptions = {}) {
    this.clock = options.clock ?? new PerformanceClock();
    this.traceFile = options.traceFile;
    this.pid = options.pid ?? process.pid;
    this.tid = options.tid ?? 0;
  }

  nowMicroseconds(): number {
    return this.clock.nowMicroseconds();
  }

  record(event: ChromeTraceEvent): void {
    this.events.push(event);
  }

  startSpan(name: string, args?: TraceArgs): Span {
    return new RecordingSpan(this, name, args, this.nowMicroseconds());
  }

  withSpan<T>(name: string, fn: () => T, args?: TraceArgs): T {
    const span = this.startSpan(name, args);
    try {
      const result = fn();
      if (isPromiseLike(result)) {
        return result.finally(() => span.end()) as T;
      }
      span.end();
      return result;
    } catch (error) {
      span.end({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  toChromeTrace(): ChromeTraceData {
    return { traceEvents: [...this.events] };
  }

  flush(): void {
    if (!this.traceFile) return;
    writeTraceFile(this.traceFile, this.toChromeTrace());
  }
}

let globalTracer: Tracer | undefined;
let exitHookRegistered = false;

export function createTracer(options: TracerOptions = {}): Tracer {
  const traceFile = options.traceFile ?? process.env[TRACE_FILE_ENV] ?? defaultTraceFile();
  const enabled = options.enabled ?? Boolean(traceFile);
  if (!enabled) return new NoopTracer();
  return new RecordingTracer({
    ...options,
    traceFile,
  });
}

export function getTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = createTracer();
    registerExitFlush(globalTracer);
  }
  return globalTracer;
}

export function startSpan(name: string, args?: TraceArgs): Span {
  return getTracer().startSpan(name, args);
}

export function withSpan<T>(name: string, fn: () => T, args?: TraceArgs): T {
  return getTracer().withSpan(name, fn, args);
}

export function flushTrace(): void {
  getTracer().flush();
}

export function resetTracerForTesting(tracer?: Tracer): void {
  globalTracer = tracer;
}

function registerExitFlush(tracer: Tracer): void {
  if (exitHookRegistered || !tracer.enabled) return;
  exitHookRegistered = true;
  process.once("beforeExit", () => {
    tracer.flush();
  });
}

function mergeArgs(startArgs?: TraceArgs, endArgs?: TraceArgs): TraceArgs | undefined {
  if (!startArgs && !endArgs) return undefined;
  return { ...(startArgs ?? {}), ...(endArgs ?? {}) };
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "finally" in value &&
    typeof (value as { finally?: unknown }).finally === "function"
  );
}

function defaultTraceFile(): string | undefined {
  const traceDir = process.env[TRACE_DIR_ENV];
  if (!traceDir) return undefined;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(traceDir, `nemoclaw-trace-${timestamp}-${process.pid}.json`);
}

function writeTraceFile(traceFile: string, trace: ChromeTraceData): void {
  const resolved = path.resolve(traceFile.replace(/^~/, os.homedir()));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(trace, null, 2)}\n`, { mode: 0o600 });
}
