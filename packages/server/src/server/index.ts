import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { app } from './app'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Add static file serving before other routes
const staticPath = path.join(__dirname, '..', '..', '..', 'ui', 'dist')
console.log('serving static files from', staticPath)
app.use(express.static(staticPath))

export const main = async () => {
  return listen(process.env.PORT ? parseInt(process.env.PORT) : 3000).then(async () => {
    return new Promise((resolve, reject) => {
      app.once('close', resolve).once('error', reject)
    }).then(() => {
      console.log('closed')
    })
  })
}

export const listen = async (port = 3000) => {
  return new Promise((resolve, reject) => {
    app
      .listen(port)
      .once('listening', () => {
        console.log('Listening on %o', port)
        resolve(null)
      })
      .once('error', reject)
  })
}
