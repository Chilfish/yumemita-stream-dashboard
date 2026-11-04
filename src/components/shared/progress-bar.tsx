import { useEffect, useRef, useState } from 'react'
import { useSpinDelay } from 'spin-delay'
import { cn } from '@/lib/utils'
import { Spinner } from './spinner'

interface ProgressBarProps {
  showSpinner?: boolean
}

function ProgressBar({ showSpinner = false }: ProgressBarProps) {
  const [loading, setLoading] = useState(false)
  const delayedPending = useSpinDelay(loading, {
    delay: 600,
    minDuration: 400,
  })
  const ref = useRef<HTMLDivElement>(null)
  const [animationComplete, setAnimationComplete] = useState(true)

  useEffect(() => {
    const start = () => setLoading(true)
    const end = () => setLoading(false)

    document.addEventListener('astro:before-preparation', start)
    document.addEventListener('astro:after-swap', end)
    document.addEventListener('astro:page-load', end)

    return () => {
      document.removeEventListener('astro:before-preparation', start)
      document.removeEventListener('astro:after-swap', end)
      document.removeEventListener('astro:page-load', end)
    }
  }, [])

  if (delayedPending && animationComplete) {
    setAnimationComplete(false)
  }

  useEffect(() => {
    if (!ref.current)
      return

    if (!delayedPending) {
      const animationPromises = ref.current
        .getAnimations()
        .map(({ finished }) => finished)

      Promise.allSettled(animationPromises).then(() => {
        if (!delayedPending)
          setAnimationComplete(true)
      })
    }
  }, [delayedPending])

  return (
    <div
      aria-hidden={delayedPending ? undefined : true}
      aria-valuetext={delayedPending ? 'Loading' : undefined}
      className="fixed inset-x-0 top-0 left-0 z-[99999] h-[3px] animate-pulse"
    >
      <div
        ref={ref}
        className={cn(
          'h-full w-0 bg-primary duration-500 ease-in-out',
          !loading
          && (animationComplete
            ? 'transition-none'
            : 'w-full opacity-0 transition-all'),
          delayedPending && 'w-8/12',
        )}
      />
      {delayedPending && showSpinner && (
        <div className="absolute top-2 right-2 flex items-center justify-center">
          <Spinner className="size-4 text-primary" />
        </div>
      )}
    </div>
  )
}

export { ProgressBar }
