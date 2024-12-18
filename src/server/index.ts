import { app } from './app'

export const main = async () => {
  return listen().then(async () => {
    return new Promise((resolve, reject) => {
      app.once('close', resolve).once('error', reject)
    }).then(() => {
      console.log('closed')
    })
  })
}

export const listen = async (port = +(process.env.PORT || 3000)) => {
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
