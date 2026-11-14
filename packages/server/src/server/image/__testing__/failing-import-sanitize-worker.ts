/**
 * Test fixture: a sanitizer worker whose code fails while it loads, before it can take a job.
 */
throw new Error('fixture cannot load')
