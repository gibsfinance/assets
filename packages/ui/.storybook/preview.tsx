import { useEffect, useMemo } from 'react'
import type { Decorator, Preview } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '../src/fonts.css'
import '../src/app.css'
import { ThemeProvider, useTheme } from '../src/lib/contexts/ThemeContext'
import { SettingsProvider } from '../src/lib/contexts/SettingsContext'
import { StudioProvider } from '../src/lib/contexts/StudioContext'
import { installMockApi } from '../src/lib/storybook/mock-api'
import type { MockApiRoutes } from '../src/lib/storybook/mock-api'

type ThemeName = 'light' | 'dark'

/**
 * Hands the toolbar's choice to the interface's own `ThemeProvider`, which is what puts the
 * `dark` class on the `html` element. The components read the same class the live site uses.
 */
function ThemeSync({ theme }: { theme: ThemeName }) {
  const { setMode } = useTheme()
  useEffect(() => setMode(theme), [setMode, theme])
  // The page behind the story follows the theme too, so a dark story never sits on white.
  useEffect(() => {
    document.body.style.backgroundColor = theme === 'dark' ? '#09090b' : '#ffffff'
  }, [theme])
  return null
}

/** Wraps every story in the providers the interface mounts around its pages. */
const withApplicationProviders: Decorator = (Story, context) => {
  const theme: ThemeName = context.globals.theme === 'dark' ? 'dark' : 'light'
  // A fresh client per story, so one story's cached answers never reach the next.
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }), [context.id])
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ThemeSync theme={theme} />
        <SettingsProvider>
          <StudioProvider>
            <div className="min-h-full bg-white p-4 text-gray-900 dark:bg-surface-base dark:text-white">
              <Story />
            </div>
          </StudioProvider>
        </SettingsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

const preview: Preview = {
  decorators: [withApplicationProviders],
  tags: ['autodocs'],
  // Runs before the story renders, so the stand-in is in place before any component asks.
  beforeEach: ({ parameters }) => installMockApi(parameters.mockApi as MockApiRoutes | undefined),
  parameters: {
    layout: 'padded',
    controls: { matchers: { color: /(background|color)$/i } },
    docs: { toc: true },
  },
  globalTypes: {
    theme: {
      description: 'Color theme, applied the way the interface applies it',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
}

export default preview
