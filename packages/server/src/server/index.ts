import { app, STATIC_PATH } from './app'

// Static serving itself is registered in app.ts. It cannot be registered here: this module
// runs after app.ts has finished, so anything added now lands behind the catch-all 404 and
// never runs.
console.log('serving static files from', STATIC_PATH)

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
