import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react"
import { useTheme } from "next-themes"
import { useTranslation } from "react-i18next"
import {
  IconAlertCircle,
  IconClockExclamation,
  IconLoader2,
  IconRefresh,
  type TablerIcon,
} from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { TURNSTILE_SCRIPT_SELECTOR, TURNSTILE_SCRIPT_URL } from "@/lib/constants/turnstile"
import {
  initialTurnstileState,
  loadTurnstileScript,
  mountTurnstile,
  turnstileLanguage,
  turnstileReducer,
  turnstileTheme,
  widgetSizeFor,
  type TurnstileHandle,
  type TurnstileScriptHost,
  type TurnstileState,
} from "@/lib/turnstile-client"

export interface TurnstileController {
  readonly enabled: boolean
  readonly state: TurnstileState
  readonly token: string | null
  readonly containerRef: React.RefObject<HTMLDivElement | null>
  readonly reset: () => void
}

function browserScriptHost(): TurnstileScriptHost {
  return {
    api: () => window.turnstile,
    findScript: () => document.querySelector<HTMLScriptElement>(TURNSTILE_SCRIPT_SELECTOR),
    addScript: () => {
      const script = document.createElement("script")
      script.src = TURNSTILE_SCRIPT_URL
      script.async = true
      script.defer = true
      document.head.appendChild(script)
      return script
    },
    setTimer: (run, ms) => {
      const timer = window.setTimeout(run, ms)
      return () => window.clearTimeout(timer)
    },
  }
}

export function useTurnstile(siteKey: string | null): TurnstileController {
  const [state, dispatch] = useReducer(turnstileReducer, undefined, initialTurnstileState)
  const [attempt, setAttempt] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<TurnstileHandle | null>(null)
  const { resolvedTheme } = useTheme()
  const { i18n } = useTranslation()
  const theme = turnstileTheme(resolvedTheme)
  const language = turnstileLanguage(i18n.language)

  useEffect(() => {
    const container = containerRef.current
    if (siteKey === null || theme === null || container === null) return
    let active = true
    dispatch({ type: "load" })
    void loadTurnstileScript(browserScriptHost()).then((api) => {
      if (!active) return
      if (api === null) {
        dispatch({ type: "failed", failure: "script" })
        return
      }
      const handle = mountTurnstile(api, container, {
        sitekey: siteKey,
        theme,
        language,
        size: widgetSizeFor(container.getBoundingClientRect().width),
        dispatch,
      })
      handleRef.current = handle
      dispatch(handle === null ? { type: "failed", failure: "challenge" } : { type: "rendered" })
    })
    return () => {
      active = false
      handleRef.current?.remove()
      handleRef.current = null
    }
  }, [siteKey, theme, language, attempt])

  const reset = useCallback(() => {
    if (handleRef.current?.reset()) {
      dispatch({ type: "reset" })
      return
    }
    dispatch({ type: "load" })
    setAttempt((count) => count + 1)
  }, [])

  return { enabled: siteKey !== null, state, token: state.token, containerRef, reset }
}

type ProblemTone = "error" | "notice"

interface ProblemBoxProps extends React.ComponentProps<"div"> {
  tone?: ProblemTone
  icon?: TablerIcon
  action?: React.ReactNode
}

export function ProblemBox({
  tone = "error",
  icon: Icon = IconAlertCircle,
  action,
  className,
  children,
  ...props
}: ProblemBoxProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-md border px-3 py-2.5 text-sm text-foreground",
        tone === "error" ? "border-destructive/30 bg-destructive/10" : "border-border bg-muted/40",
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 size-4 shrink-0", tone === "error" ? "text-destructive" : "text-muted-foreground")}
        />
        {children}
      </div>
      {action}
    </div>
  )
}

interface TurnstileWidgetProps {
  turnstile: TurnstileController
  className?: string
}

export function TurnstileWidget({ turnstile, className }: TurnstileWidgetProps) {
  const { t } = useTranslation("auth")
  const statusId = useId()
  const groupRef = useRef<HTMLDivElement>(null)
  const { state, containerRef, reset } = turnstile
  const scriptFailed = state.failure === "script"
  const showProblem = state.status === "error" || state.status === "expired"
  const showPlaceholder = state.status === "loading" && !state.rendered

  const announcement = {
    loading: state.rechecking ? t("turnstile.rechecking") : t("turnstile.loading"),
    ready: t("turnstile.passed"),
    expired: t("turnstile.expired"),
    error: scriptFailed ? t("turnstile.script_failed") : t("turnstile.challenge_failed"),
  }[state.status]

  const retry = () => {
    reset()
    groupRef.current?.focus()
  }

  return (
    <div
      ref={groupRef}
      tabIndex={-1}
      role="group"
      aria-label={t("turnstile.label")}
      aria-describedby={statusId}
      data-testid="turnstile-widget"
      data-turnstile-state={state.status}
      className={cn(
        "@container rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
    >
      <div className="grid min-h-35 pointer-coarse:min-h-38 @min-[300px]:min-h-26 @min-[300px]:pointer-coarse:min-h-29">
        <div
          ref={containerRef}
          className={cn(
            "col-start-1 row-start-1 flex justify-center self-center leading-0 @min-[300px]:block",
            showProblem && "invisible"
          )}
        />
        {showPlaceholder && (
          <div
            aria-hidden="true"
            className="col-start-1 row-start-1 flex h-35 w-37.5 flex-col items-center justify-center gap-2 self-center justify-self-center rounded-md border border-border bg-muted/30 px-3 text-center text-xs text-muted-foreground @min-[300px]:h-16.25 @min-[300px]:w-full @min-[300px]:flex-row @min-[300px]:text-sm"
          >
            <IconLoader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
            {t("turnstile.loading")}
          </div>
        )}
        {showProblem && (
          <ProblemBox
            data-testid="turnstile-problem"
            tone={state.status === "error" ? "error" : "notice"}
            icon={state.status === "error" ? IconAlertCircle : IconClockExclamation}
            className="col-start-1 row-start-1 self-stretch"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={retry}
                data-testid="turnstile-retry"
                className="pointer-coarse:h-11"
              >
                <IconRefresh aria-hidden="true" />
                {t("turnstile.retry")}
              </Button>
            }
          >
            <p aria-hidden="true">{announcement}</p>
          </ProblemBox>
        )}
      </div>
      <p id={statusId} role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
