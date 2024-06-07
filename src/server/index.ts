import { app } from './app'
import './routes'

export const main = async () => {
  return listen().then(() => {
    return new Promise((resolve, reject) => {
      app.once('close', resolve).once('error', reject)
    })
  })
}

export const listen = async (port = +(process.env.PORT || 3000)) => {
  return new Promise((resolve, reject) => {
    app.listen(port).once('listening', resolve).once('error', reject)
  })
}
