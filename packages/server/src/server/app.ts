import bodyParser from 'body-parser'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import responseTime from 'response-time'
import { router } from './routes'
import { errorMiddleware, JSON_BODY_LIMIT } from './middleware'

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

app.use(router)

// Final error funnel — intentional 4xx keep their message, everything else
// is logged server-side and sanitized to a generic 500 (see middleware.ts).
app.use(errorMiddleware)
