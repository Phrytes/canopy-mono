function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const TaskState = Object.freeze({
  SUBMITTED: 'submitted',
  WORKING:   'working',
  COMPLETED: 'completed',
  FAILED:    'failed',
  CANCELLED: 'cancelled',
  REJECTED:  'rejected',
});

export class Task {
  constructor({ id, skill, params = {}, state = TaskState.SUBMITTED, result = null, error = null } = {}) {
    this.id        = id ?? uid();
    this.skill     = skill;
    this.params    = params;
    this.state     = state;
    this.result    = result;
    this.error     = error;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  transition(state, { result, error } = {}) {
    this.state     = state;
    this.result    = result ?? this.result;
    this.error     = error  ?? this.error;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  toJSON() {
    return {
      id: this.id, skill: this.skill, params: this.params,
      state: this.state, result: this.result, error: this.error,
      createdAt: this.createdAt, updatedAt: this.updatedAt,
    };
  }

  static fromJSON(data) { return new Task(data); }
}
