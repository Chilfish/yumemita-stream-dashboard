import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

export interface AppConfigs {
  theme: Theme
}

interface AppConfigState extends AppConfigs {
  setTheme: (theme: Theme) => void
}

export const useAppConfigStore = create<AppConfigState>()(
  persist(
    set => ({
      theme: 'system',
      setTheme: theme => set({ theme }),
    }),
    {
      name: 'app-config-store',
      version: 1,
    },
  ),
)
