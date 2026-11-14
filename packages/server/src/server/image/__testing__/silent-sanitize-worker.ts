/**
 * Test fixture: a sanitizer worker that takes every job and never answers, so a deadline has to stop it.
 */
import { parentPort } from 'node:worker_threads'

parentPort?.on('message', () => undefined)
