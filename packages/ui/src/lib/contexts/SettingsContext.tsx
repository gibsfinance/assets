import { createContext, useContext, type ReactNode } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'

type SettingsContextValue = {
  showTestnets: boolean
  setShowTestnets: (value: boolean) => void
}

const SettingsContext = createContext<SettingsContextValue>({
  showTestnets: false,
  setShowTestnets: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [showTestnets, setShowTestnets] = useLocalStorage('showTestnets', false)
  return (
    <SettingsContext.Provider value={{ showTestnets, setShowTestnets }}>
      {children}
    </SettingsContext.Provider>
  )
}

export const useSettings = () => useContext(SettingsContext)
