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
}

export const JOB_TTL_MS = 60 * 60 * 1000;

/** Batch jobs kept in memory; expired ones are dropped whenever the store is touched. */
export class JobStore {
  private jobs = new Map<string, Job>();

  create(total: number): Job {
    this.purge();
    const job: Job = { id: randomUUID(), status: 'running', total, completed: 0, report: [], files: [], created: Date.now() };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    this.purge();
    return this.jobs.get(id);
  }

  private purge(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, j] of this.jobs) if (j.created < cutoff) this.jobs.delete(id);
  }
}
