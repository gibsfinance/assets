import { Box, Text } from 'ink'
import React from 'react'

export interface StatusProps {
  provider: string
  message: string
  current?: number
  total?: number
  phase: 'setup' | 'processing' | 'storing' | 'complete'
}

const phaseEmoji = {
  setup: '🏗️',
  processing: '📥',
  storing: '💾',
  complete: '✨',
} as const

export const Status: React.FC<StatusProps> = ({ provider, message, current, total, phase = 'processing' }) => {
  const progress = total ? ` ${current}/${total}` : ''
  const emoji = phaseEmoji[phase]

  return (
    <Box>
      <Text>
        {emoji} [{provider}] {message}
        {progress}
      </Text>
    </Box>
  )
}
