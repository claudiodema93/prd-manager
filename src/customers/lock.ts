/**
 * Serialises customer operations that touch both the filesystem and the cache.
 *
 * The main process is single-threaded, but the service uses asynchronous
 * filesystem calls: two overlapping scans (startup + manual refresh) or a
 * create racing a scan would otherwise interleave and write inconsistent
 * rows. A promise chain is enough; it is not re-entrant, so callers must not
 * nest `withCustomerLock` calls.
 */
let tail: Promise<void> = Promise.resolve();

export function withCustomerLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = tail.then(operation, operation);
  tail = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}
