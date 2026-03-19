import { useMemo } from 'react'
import { useTheme } from '../contexts/ThemeContext'

const darkModeMessages = [
  'Embrace the darkness...',
  'Join the dark side!',
  'Time to go stealth',
  'Night mode activated',
  'Going incognito...',
  'Welcome to the shadows',
  'Dark mode is the way',
  'Stealth mode engaged',
  'Eyes will thank you',
  'Darkness beckons...',
]

const lightModeMessages = [
  'MY EYES NEED THE LIGHT!',
  'Let there be light!',
  'Time to shine \u2728',
  'Brightness intensifies',
  'Hello sunshine!',
  'Illumination activated',
  'Light side prevails',
  'Photons into my ojos',
  'Embrace the glow',
  'Power of the light!',
]

function getRandomMessage(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)]
}

export function ThemeToggle() {
  const { isDark, toggle } = useTheme()

  const title = useMemo(
    () => getRandomMessage(isDark ? lightModeMessages : darkModeMessages),
    [isDark],
  )

  return (
    <button className="variant-ghost-surface btn-icon" onClick={toggle} title={title}>
      {isDark ? (
        <i className="fas fa-sun text-xl"></i>
      ) : (
        <i className="fas fa-moon text-xl"></i>
      )}
    </button>
  )
}
