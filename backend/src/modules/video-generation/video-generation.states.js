const JOB_STATUSES = Object.freeze({
  QUEUED: 'queued',
  SUBMITTING: 'submitting',
  SUBMITTED: 'submitted',
  PROCESSING: 'processing',
  STORING: 'storing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
});

const TERMINAL_JOB_STATUSES = new Set([
  JOB_STATUSES.SUCCEEDED,
  JOB_STATUSES.FAILED,
  JOB_STATUSES.CANCELLED,
  JOB_STATUSES.EXPIRED
]);

const JOB_TRANSITIONS = Object.freeze({
  [JOB_STATUSES.QUEUED]: new Set([JOB_STATUSES.SUBMITTING, JOB_STATUSES.SUBMITTED, JOB_STATUSES.FAILED, JOB_STATUSES.CANCELLED, JOB_STATUSES.EXPIRED]),
  [JOB_STATUSES.SUBMITTING]: new Set([JOB_STATUSES.SUBMITTED, JOB_STATUSES.FAILED, JOB_STATUSES.CANCELLED, JOB_STATUSES.EXPIRED]),
  // A provider's COMPLETED state is only a storage prerequisite.  Success is
  // deliberately reachable only from storing after atomic file commit.
  [JOB_STATUSES.SUBMITTED]: new Set([JOB_STATUSES.PROCESSING, JOB_STATUSES.STORING, JOB_STATUSES.FAILED, JOB_STATUSES.CANCELLED, JOB_STATUSES.EXPIRED]),
  [JOB_STATUSES.PROCESSING]: new Set([JOB_STATUSES.STORING, JOB_STATUSES.FAILED, JOB_STATUSES.CANCELLED, JOB_STATUSES.EXPIRED]),
  [JOB_STATUSES.STORING]: new Set([JOB_STATUSES.SUCCEEDED, JOB_STATUSES.FAILED, JOB_STATUSES.EXPIRED]),
  [JOB_STATUSES.SUCCEEDED]: new Set(),
  [JOB_STATUSES.FAILED]: new Set(),
  [JOB_STATUSES.CANCELLED]: new Set(),
  [JOB_STATUSES.EXPIRED]: new Set()
});

const RESERVATION_STATUSES = Object.freeze({
  RESERVED: 'reserved',
  FINALIZED: 'finalized',
  RELEASED: 'released',
  EXPIRED: 'expired'
});

const TERMINAL_RESERVATION_STATUSES = new Set([
  RESERVATION_STATUSES.FINALIZED,
  RESERVATION_STATUSES.RELEASED,
  RESERVATION_STATUSES.EXPIRED
]);

const RESERVATION_TRANSITIONS = Object.freeze({
  [RESERVATION_STATUSES.RESERVED]: new Set([
    RESERVATION_STATUSES.FINALIZED,
    RESERVATION_STATUSES.RELEASED,
    RESERVATION_STATUSES.EXPIRED
  ]),
  [RESERVATION_STATUSES.FINALIZED]: new Set(),
  [RESERVATION_STATUSES.RELEASED]: new Set(),
  [RESERVATION_STATUSES.EXPIRED]: new Set()
});

const isTerminalJobStatus = (status) => TERMINAL_JOB_STATUSES.has(status);
const isTerminalReservationStatus = (status) => TERMINAL_RESERVATION_STATUSES.has(status);
const canTransitionJob = (from, to) => Boolean(JOB_TRANSITIONS[from]?.has(to));
const canTransitionReservation = (from, to) => Boolean(RESERVATION_TRANSITIONS[from]?.has(to));
const isIdempotentJobTransition = (from, to) => from === to || canTransitionJob(from, to);

module.exports = {
  JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  JOB_TRANSITIONS,
  RESERVATION_STATUSES,
  TERMINAL_RESERVATION_STATUSES,
  RESERVATION_TRANSITIONS,
  isTerminalJobStatus,
  isTerminalReservationStatus,
  canTransitionJob,
  canTransitionReservation,
  isIdempotentJobTransition
};
