import { randomUUID } from 'node:crypto';
import type { Report } from '@pixel3d/core';

export interface JobFile { name: string; bytes: Uint8Array }

export interface Job {
  id: string;
  status: 'running' | 'done';
  total: number;
  completed: number;
  report: Report[];
  files: JobFile[];
  /** When the job was created (ms since epoch). */
  created: number;
  /** When the job finished (ms since epoch); the TTL runs from here. */
  finished?: number;
}

export const JOB_TTL_MS = 60 * 60 * 1000;
export const MAX_JOBS = 50;
const SWEEP_MS = 5 * 60 * 1000;

export interface JobStoreOptions {
  ttlMs?: number;
  maxJobs?: number;
  now?: () => number;
}

/** Batch jobs kept in memory: finished ones expire after the TTL, and the store holds at most `maxJobs`. */
export class JobStore {
  private jobs = new Map<string, Job>();
  private ttl: number;
  private max: number;
  private now: () => number;

  constructor(opts: JobStoreOptions = {}) {
    this.ttl = opts.ttlMs ?? JOB_TTL_MS;
    this.max = opts.maxJobs ?? MAX_JOBS;
    this.now = opts.now ?? Date.now;
    setInterval(() => this.purge(), SWEEP_MS).unref();
  }

  /** A new running job, or undefined when the store is full of running jobs. */
  create(total: number): Job | undefined {
    this.purge();
    if (this.jobs.size >= this.max) {
      // jobs are kept in creation order, so the first done one is the oldest
      const oldestDone = [...this.jobs.values()].find((j) => j.status === 'done');
      if (!oldestDone) return undefined;
      this.jobs.delete(oldestDone.id);
    }
    const job: Job = { id: randomUUID(), status: 'running', total, completed: 0, report: [], files: [], created: this.now() };
    this.jobs.set(job.id, job);
    return job;
  }

  /** Mark a job done and start its expiry clock. */
  finish(job: Job): void {
    job.status = 'done';
    job.finished = this.now();
  }

  get(id: string): Job | undefined {
    this.purge();
    return this.jobs.get(id);
  }

  private purge(): void {
    const cutoff = this.now() - this.ttl;
    for (const [id, j] of this.jobs) if (j.finished !== undefined && j.finished < cutoff) this.jobs.delete(id);
  }
}
