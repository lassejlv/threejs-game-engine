import { createStore } from '../engine'

export type LogLevel = 'log' | 'warn' | 'error'

export interface LogEntry {
  id: number
  level: LogLevel
  message: string
  count: number
  time: number
}

const MAX_ENTRIES = 300

export const consoleStore = createStore({ entries: [] as LogEntry[] })

/** Extra sinks for log lines (the exported player forwards them to the browser console). */
export const logListeners = new Set<(level: LogLevel, message: string) => void>()

let nextId = 0
let pending: LogEntry[] = []
let timer: ReturnType<typeof setTimeout> | null = null

/** Batched so a script logging every frame doesn't re-render the console 60x/second. */
export function log(level: LogLevel, ...args: unknown[]): void {
  const message = args.map(format).join(' ')
  for (const listener of logListeners) listener(level, message)
  const last = pending.at(-1) ?? consoleStore.get().entries.at(-1)
  if (last && last.level === level && last.message === message) {
    if (pending.at(-1) === last) last.count++
    else pending.push({ ...last, count: last.count + 1, time: Date.now(), id: last.id })
  } else {
    pending.push({ id: nextId++, level, message, count: 1, time: Date.now() })
  }
  timer ??= setTimeout(flush, 100)
}

export function clearConsole(): void {
  pending = []
  consoleStore.set({ entries: [] })
}

function flush(): void {
  timer = null
  const entries = [...consoleStore.get().entries]
  for (const entry of pending) {
    const index = entries.length - 1
    if (index >= 0 && entries[index].id === entry.id) entries[index] = entry
    else entries.push(entry)
  }
  pending = []
  consoleStore.set({ entries: entries.slice(-MAX_ENTRIES) })
}

function format(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
