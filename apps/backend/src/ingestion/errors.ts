/**
 * Thrown anywhere in the ingestion pipeline. `retryable: false` maps to
 * BullMQ's UnrecoverableError in the job processor (see plan/03) - a
 * corrupt PDF or unsupported type will never succeed on retry, so failing
 * fast beats burning three attempts and 90s.
 */
export class IngestionError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "IngestionError";
  }
}
