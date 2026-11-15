/**
 * Test fixture: a sanitizer worker that loads and then never reports ready, as a worker whose module load hangs
 * would. It keeps its thread alive until the pool stops it.
 */
setInterval(() => undefined, 60_000)
