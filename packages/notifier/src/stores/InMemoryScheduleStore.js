/**
 * InMemoryScheduleStore — Map-backed schedule store.  Lost on
 * restart.  V1+ adds PodScheduleStore for restart-survival.
 */

export class InMemoryScheduleStore {
  /** @type {Map<string, import('../types.js').Job>} */
  #jobs = new Map();

  async put(job) {
    this.#jobs.set(job.jobId, { ...job });
  }

  async get(jobId) {
    const j = this.#jobs.get(jobId);
    return j ? { ...j } : null;
  }

  async listAll() {
    return [...this.#jobs.values()].map((j) => ({ ...j }));
  }

  async remove(jobId) {
    this.#jobs.delete(jobId);
  }

  async removeByCancelKey(cancelKey) {
    for (const [id, j] of this.#jobs) {
      if (j.cancelKey === cancelKey) this.#jobs.delete(id);
    }
  }
}
