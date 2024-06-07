import * as server from '@/server'

server.main().catch((err) => {
  console.error(err)
})
