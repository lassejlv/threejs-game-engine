import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startRelay } from '../../../server/relay.mjs'
import { logListeners } from '../console'
import { type NetEvent, NetClient } from './network'

let relay: Awaited<ReturnType<typeof startRelay>>
let url: string
const clients: NetClient[] = []

beforeEach(async () => {
  relay = await startRelay({ port: 0, host: '127.0.0.1' })
  url = `ws://127.0.0.1:${relay.port}`
})

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect()
  await relay.close()
})

function client(room = 'game/lobby', name = ''): NetClient {
  const c = new NetClient()
  clients.push(c)
  c.connect(url, room, name)
  return c
}

/** Collects a client's events until `done` says so. */
async function until<T>(fn: () => T | undefined, timeout = 2000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = fn()
    if (value !== undefined && value !== false) return value
    if (Date.now() - start > timeout) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('NetClient with the relay', () => {
  it('joins a room, sees others join and leave, and passes the host on', async () => {
    const a = client('game/lobby', 'Ada')
    await until(() => a.status === 'online')
    expect(a.isHost).toBe(true)
    const b = client('game/lobby', 'Bo')
    await until(() => b.status === 'online')
    expect(b.players.map((p) => p.name).sort()).toEqual(['Ada', 'Bo'])
    expect(b.isHost).toBe(false)
    const joined = await until(() => a.take().find((e): e is Extract<NetEvent, { kind: 'join' }> => e.kind === 'join'))
    expect(joined.player.name).toBe('Bo')
    b.take()

    a.disconnect()
    const left = await until(() => b.take().find((e) => e.kind === 'leave'))
    expect(left.kind === 'leave' && left.player.name).toBe('Ada')
    expect(b.isHost).toBe(true)
  })

  it('broadcasts messages, sends direct ones and queues sends made while connecting', async () => {
    const a = client()
    a.send('early', 1) // before the connection opens
    const b = client()
    const c = client()
    await until(() => a.status === 'online' && b.status === 'online' && c.status === 'online' && a.players.length === 3)
    const messages = (x: NetClient) => x.take().filter((e) => e.kind === 'message')
    b.send('hello', { n: 2 })
    b.send('psst', 'secret', a.id!)
    const atA = await until(() => {
      const m = messages(a)
      return m.length >= 2 ? m : undefined
    })
    expect(atA.map((m) => m.kind === 'message' && [m.type, m.data, m.from.id])).toEqual([
      ['hello', { n: 2 }, b.id],
      ['psst', 'secret', b.id],
    ])
    const atC = await until(() => {
      const m = messages(c)
      return m.some((e) => e.kind === 'message' && e.type === 'hello') ? m : undefined
    })
    expect(atC.some((e) => e.kind === 'message' && e.type === 'psst')).toBe(false)
    // 'early' was sent before anyone else joined, so nobody received it, but it didn't throw or get lost as an error.
    expect(a.status).toBe('online')
  })

  it('syncs player state, throttled, and gives it to players who join later', async () => {
    const a = client()
    await until(() => a.status === 'online')
    a.setState({ p: [1, 2, 3] })
    a.flush(0)
    a.setState({ p: [4, 5, 6] })
    a.flush(10) // inside the throttle window: not sent yet
    const b = client()
    await until(() => b.status === 'online')
    expect(b.players.find((p) => p.id === a.id)?.state).toEqual({ p: [1, 2, 3] })
    a.flush(100)
    await until(() => (b.players.find((p) => p.id === a.id)?.state.p as number[])[0] === 4)
    // Your own entry shows your local state right away.
    expect(a.players.find((p) => p.isMe)?.state).toEqual({ p: [4, 5, 6] })
  })

  it('keeps rooms apart', async () => {
    const a = client('one/lobby')
    const b = client('two/lobby')
    await until(() => a.status === 'online' && b.status === 'online')
    expect(a.players).toHaveLength(1)
    expect(b.players).toHaveLength(1)
  })

  it('reports a server it cannot reach', async () => {
    const warn = vi.fn()
    logListeners.add(warn)
    const c = new NetClient()
    clients.push(c)
    c.connect('ws://127.0.0.1:1', 'game/lobby', '')
    await until(() => c.status === 'error')
    logListeners.delete(warn)
    expect(warn.mock.calls.some(([level, message]) => level === 'warn' && String(message).includes('could not reach'))).toBe(true)
  })
})
