import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { app } from './app'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Add static file serving before other routes
app.use(express.static(path.join(__dirname, '../../frontend/build')))
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/build/index.html'))
})

export const main = async () => {
  return listen().then(async () => {
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
