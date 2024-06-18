import * as express from 'express'
import bodyParser from 'body-parser'
import { router } from './routes'
import responseTime from 'response-time'
import cors from 'cors'

export const app = express.default()

app.use(responseTime())
app.use(cors())
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

app.use(router)
