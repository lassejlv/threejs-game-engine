import type { Engine } from '../../engine'
import { log } from '../console'

/** Another player in the room (or you). `state` is what they last passed to `setState`. */
export interface NetPlayer {
  readonly id: string
  readonly name: string
  readonly state: Record<string, unknown>
  /** The host is the player who has been in the room longest; it moves on when they leave. */
  readonly isHost: boolean
  readonly isMe: boolean
}

export type NetStatus = 'offline' | 'connecting' | 'online' | 'error'

/** Script-facing multiplayer (`ctx.net`), backed by the relay in server/relay.mjs. */
export interface NetApi {
  /** Joins a room on the project's multiplayer server; calling it again for the same room does nothing. */
  connect(room?: string, options?: { name?: string }): void
  disconnect(): void
  readonly status: NetStatus
  /** Your player id, once online. */
  readonly id: string | null
  readonly isHost: boolean
  /** Everyone in the room, you included. */
  readonly players: NetPlayer[]
  /** Sends `data` (JSON) to everyone else, or to one player id. */
  send(type: string, data?: unknown, to?: string): void
  /** Handles messages of `type`; returns a function that stops listening. Removed with this entity. */
  on(type: string, fn: (data: any, from: NetPlayer) => void): () => void
  onJoin(fn: (player: NetPlayer) => void): () => void
  onLeave(fn: (player: NetPlayer) => void): () => void
  /** Merges into your synced state (position, score…); sent at most 20 times a second. */
  setState(patch: Record<string, unknown>): void
}

export type NetEvent =
  | { kind: 'join'; player: NetPlayer }
  | { kind: 'leave'; player: NetPlayer }
  | { kind: 'message'; type: string; data: unknown; from: NetPlayer }

interface Entry {
  id: string
  name: string
  state: Record<string, unknown>
}

type ServerMessage =
  | { t: 'welcome'; id: string; host: string | null; players: Entry[] }
  | { t: 'join'; player: Entry }
  | { t: 'leave'; id: string; host: string | null }
  | { t: 'msg'; from: string; type: string; data: unknown }
  | { t: 'state'; from: string; data: Record<string, unknown> | null }
  | { t: 'error'; message: string }

const STATE_INTERVAL = 50
const clients = new WeakMap<Engine, NetClient>()

/**
 * One connection per engine, kept across scene switches. Incoming events are
 * queued and handed to scripts once per frame (`take`), so callbacks run
 * inside the game loop like everything else.
 */
export class NetClient {
  status: NetStatus = 'offline'
  id: string | null = null
  private host: string | null = null
  private socket: WebSocket | null = null
  private key = ''
  private readonly entries = new Map<string, Entry>()
  private events: NetEvent[] = []
  private local: Record<string, unknown> = {}
  private stateDirty = false
  private lastStateSent = -Infinity
  /** Messages sent while still connecting. */
  private outbox: string[] = []

  static for(engine: Engine): NetClient {
    let client = clients.get(engine)
    if (!client) clients.set(engine, (client = new NetClient()))
    return client
  }

  /** The engine's client if it ever made one. */
  static peek(engine: Engine): NetClient | undefined {
    return clients.get(engine)
  }

  /** Leaves the room (when play stops). */
  static closeFor(engine: Engine): void {
    clients.get(engine)?.disconnect()
  }

  connect(url: string, room: string, name: string): void {
    const key = `${url}\n${room}`
    if (key === this.key && (this.status === 'connecting' || this.status === 'online')) return
    this.disconnect()
    this.key = key
    this.status = 'connecting'
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      this.fail(url, error instanceof Error ? error.message : String(error))
      return
    }
    this.socket = socket
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: 'join', room, name }))
    }
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return
      try {
        this.receive(JSON.parse(event.data) as ServerMessage)
      } catch (error) {
        log('warn', 'Multiplayer: bad message from server', error)
      }
    }
    socket.onerror = () => {
      if (this.socket === socket && this.status === 'connecting') this.fail(url, 'connection failed')
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      if (this.status === 'online') log('warn', 'Multiplayer: disconnected from the server')
      this.reset(this.status === 'error' ? 'error' : 'offline')
    }
  }

  disconnect(): void {
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.reset('offline')
    this.events = []
    this.local = {}
  }

  send(type: string, data?: unknown, to?: string): void {
    const text = JSON.stringify({ t: 'msg', type, data: data ?? null, ...(to !== undefined && { to }) })
    if (this.status === 'online') this.socket?.send(text)
    else if (this.status === 'connecting') this.outbox.push(text)
  }

  setState(patch: Record<string, unknown>): void {
    Object.assign(this.local, patch)
    this.stateDirty = true
    const me = this.id ? this.entries.get(this.id) : undefined
    if (me) me.state = { ...this.local }
  }

  /** Sends pending state (throttled); call once per frame. */
  flush(now: number): void {
    if (!this.stateDirty || this.status !== 'online' || now - this.lastStateSent < STATE_INTERVAL) return
    this.socket?.send(JSON.stringify({ t: 'state', data: this.local }))
    this.stateDirty = false
    this.lastStateSent = now
  }

  /** Events since the last call. */
  take(): NetEvent[] {
    const events = this.events
    this.events = []
    return events
  }

  get players(): NetPlayer[] {
    return [...this.entries.values()].map((e) => this.view(e))
  }

  get isHost(): boolean {
    return this.id !== null && this.id === this.host
  }

  private view(entry: Entry): NetPlayer {
    return { id: entry.id, name: entry.name, state: entry.state, isHost: entry.id === this.host, isMe: entry.id === this.id }
  }

  private receive(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome': {
        this.status = 'online'
        this.id = message.id
        this.host = message.host
        for (const p of message.players) this.entries.set(p.id, { ...p, state: p.state ?? {} })
        const me = this.entries.get(message.id)
        if (me) me.state = { ...this.local }
        for (const p of message.players) if (p.id !== message.id) this.events.push({ kind: 'join', player: this.view(this.entries.get(p.id)!) })
        for (const text of this.outbox) this.socket?.send(text)
        this.outbox = []
        this.stateDirty = Object.keys(this.local).length > 0
        break
      }
      case 'join': {
        const entry = { ...message.player, state: message.player.state ?? {} }
        this.entries.set(entry.id, entry)
        this.events.push({ kind: 'join', player: this.view(entry) })
        break
      }
      case 'leave': {
        const entry = this.entries.get(message.id)
        this.entries.delete(message.id)
        this.host = message.host
        if (entry) this.events.push({ kind: 'leave', player: this.view(entry) })
        break
      }
      case 'state': {
        const entry = this.entries.get(message.from)
        if (entry) entry.state = message.data ?? {}
        break
      }
      case 'msg': {
        const entry = this.entries.get(message.from)
        if (entry) this.events.push({ kind: 'message', type: message.type, data: message.data, from: this.view(entry) })
        break
      }
      case 'error':
        log('warn', `Multiplayer: ${message.message}`)
        break
    }
  }

  private fail(url: string, reason: string): void {
    log('warn', `Multiplayer: could not reach ${url} (${reason}). Start a relay with \`npm run server\` or set the server in Project Settings.`)
    this.reset('error')
  }

  private reset(status: NetStatus): void {
    this.status = status
    this.id = null
    this.host = null
    this.entries.clear()
    this.outbox = []
    this.stateDirty = false
    this.lastStateSent = -Infinity
  }
}
