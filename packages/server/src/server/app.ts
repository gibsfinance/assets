import bodyParser from 'body-parser'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import path from 'path'
import responseTime from 'response-time'
import { fileURLToPath } from 'url'
import { router } from './routes'
import { errorMiddleware, notFoundMiddleware, JSON_BODY_LIMIT } from './middleware'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

/**
 * The built interface, which this server also serves.
 *
 * Resolved from this file's own directory rather than the working directory, so it
 * holds wherever the process is started from.
 */
export const STATIC_PATH = path.join(currentDirectory, '..', '..', '..', 'ui', 'dist')

export const app = express() as express.Express

app.use(responseTime())
app.use(cors())
app.use(compression())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json({ limit: JSON_BODY_LIMIT }))

/** Readiness flag — flipped to true after migrations + warm-up complete. */
let ready = false

export function setReady() {
  ready = true
}

app.get('/health', (_req, res) => {
  if (!ready) {
    res.status(503).json({ status: 'starting' })
    return
  }
  res.json({ status: 'ok' })
})

// The interface is served before the router and, critically, before the catch-all below.
// This registration used to live in index.ts, which appends to the stack after this module
// has finished executing — fine while nothing followed the router, because static was then
// the last handler and every miss reached it. Adding notFoundMiddleware put a handler that
// claims *everything* in front of it, and the whole site began answering JSON 404 for
// index.html and every asset. Keep this above the catch-all.
app.use(express.static(STATIC_PATH))

app.use(router)

// Anything neither the interface nor the router claimed is a 404 in this app's own JSON
// shape rather than express's default HTML page. Must sit after both and before the error
// funnel.
app.use(notFoundMiddleware)

// Final error funnel — intentional 4xx keep their message, everything else
// is logged server-side and sanitized to a generic 500 (see middleware.ts).
app.use(errorMiddleware)
