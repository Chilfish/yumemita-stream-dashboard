import type * as React from 'react'
import type { Theme } from '@/stores/appConfig'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useHydrated } from '@/hooks/use-hydrated'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/menu'
import { useAppConfigStore } from '@/stores/appConfig'

interface ThemeOption {
  icon: typeof Sun
  label: string
  value: Theme
}

const themeOptions: ThemeOption[] = [
  { icon: Sun, label: '浅色', value: 'light' },
  { icon: Moon, label: '深色', value: 'dark' },
  { icon: Monitor, label: '跟随系统', value: 'system' },
]

export function ThemeToggle(): React.ReactElement {
  const hydrated = useHydrated()
  const theme = useAppConfigStore(state => state.theme)
  const setTheme = useAppConfigStore(state => state.setTheme)

  if (!hydrated) {
    return (
      <Button
        aria-hidden="true"
        className="pointer-events-none"
        size="icon"
        tabIndex={-1}
        variant="outline"
      />
    )
  }

  const current = themeOptions.find(option => option.value === theme) ?? themeOptions[0]
  const CurrentIcon = current.icon

  const handleValueChange = (value: Theme): void => {
    setTheme(value)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            aria-label={`切换主题，当前${current.label}`}
            className="focus-visible:ring-2 focus-visible:ring-ring"
            size="icon"
            variant="outline"
          />
        )}
      >
        <CurrentIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40" sideOffset={6}>
        <DropdownMenuRadioGroup value={theme} onValueChange={handleValueChange}>
          <DropdownMenuLabel>主题</DropdownMenuLabel>
          {themeOptions.map(({ icon: Icon, label, value }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
