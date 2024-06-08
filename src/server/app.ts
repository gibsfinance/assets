import * as express from 'express'
import bodyParser from 'body-parser'
import { router } from './routes'

export const app = express.default()

app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

app.use(router)
