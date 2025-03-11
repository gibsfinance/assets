import { render } from 'ink'
import { Status, type StatusProps } from '../components/Status'

let statusInstance: ReturnType<typeof render> | null = null
let isRunning = true

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  stop('Stopped by user')
})

export const stop = (message = 'Stopped') => {
  isRunning = false
  if (statusInstance) {
    statusInstance.rerender(<Status provider="system" message={message} phase="complete" />)
    setTimeout(() => {
      if (statusInstance) {
        statusInstance.unmount()
        statusInstance = null
      }
      process.exit(0)
    }, 100)
  } else {
    process.exit(0)
  }
}

export function updateStatus(props: StatusProps): void {
  if (!isRunning) return

  if (!statusInstance) {
    statusInstance = render(<Status {...props} />)
  } else {
    statusInstance.rerender(<Status {...props} />)
  }
}

export const clearStatus = () => {
  if (statusInstance) {
    statusInstance.unmount()
    statusInstance = null
  }
}
