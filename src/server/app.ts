/**
 * @title Express Application Configuration
 * @notice Main Express application setup with middleware and error handling
 * @dev This module configures the Express application with necessary middleware
 * and error handling for the asset service
 */

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

/**
 * @notice Health Check Endpoint
 * @dev Simple endpoint for monitoring service health
 * Returns 200 OK with JSON response
 * Used by frontend to check if the service is running, if not, will pull from gib.show
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use(router)

/**
 * @notice Error Handling Middleware
 * @dev Custom error handling with specific cases:
 * 1. Silent 404s for expected missing resources (images/networks)
 * 2. Logged errors for all other cases
 * @param err The error object from previous middleware
 * @param req Express request object (unused)
 * @param res Express response object for sending error response
 * @param next Next middleware function
 */
app.use((err: HttpError, req: express.Request, res: express.Response, next: express.NextFunction) => {
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
