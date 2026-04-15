import bodyParser from 'body-parser'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import responseTime from 'response-time'
import { router } from './routes'
import { HttpError } from 'http-errors'

export const app = express() as express.Express

app.use(responseTime())
app.use(cors())
app.use(compression())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

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

/**
 * Error Handling Middleware
 * @param err The error object from previous middleware
 * @param req Express request object (unused)
 * @param res Express response object for sending error response
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: HttpError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // console.log(req.url)
  // console.error('handling error', err.stack)
  // res.status(500).send('Something broke!')
  // Don't log 404s for missing images/networks as these are expected
  if (err.status === 404 && err.message.includes('image not found')) {
    res.status(404).json({ error: err.message })
    return
  }
  // Log other errors
  // console.error(err)
  res.status(err.status || 500).json({ error: err.message })
})
