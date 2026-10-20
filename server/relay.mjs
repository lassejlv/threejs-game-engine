// Multiplayer relay for games made with the engine: players join a room and
// the server forwards their messages and remembers each player's synced state
// for newcomers. It holds no game logic; the first player in a room is its host.
//
//   npm run server                 # ws://localhost:8787
//   PORT=9000 node server/relay.mjs
//
// Protocol (JSON text frames). Client → server:
//   { t: 'join', room, name }      first message, once
//   { t: 'msg', type, data, to? }  to one player id, or everyone else
//   { t: 'state', data }           replaces this player's synced state
// Server → client:
//   { t: 'welcome', id, host, players: [{ id, name, state }] }
//   { t: 'join', player: { id, name, state } }
//   { t: 'leave', id, host }
//   { t: 'msg', from, type, data }
//   { t: 'state', from, data }
//   { t: 'error', message }

import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'

const MAX_PLAYERS = 16
const MAX_MESSAGE = 64 * 1024
const MAX_NAME = 32
const MAX_ROOM = 128

/**
 * @typedef {{ id: string, name: string, state: unknown, socket: import('ws').WebSocket, room: Room | null, alive: boolean }} Player
 * @typedef {{ name: string, players: Map<string, Player> }} Room
 */

/** Starts a relay. Resolves with its port and a `close` function. */
export function startRelay({ port = 8787, host } = {}) {
  /** @type {Map<string, Room>} */
  const rooms = new Map()
  /** @type {Map<import('ws').WebSocket, Player>} */
  const connected = new Map()
  let nextId = 1

  const http = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
    res.end(`game relay: ${rooms.size} rooms\n`)
  })
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE })

  const send = (/** @type {Player} */ player, /** @type {object} */ message) => {
    if (player.socket.readyState === player.socket.OPEN) player.socket.send(JSON.stringify(message))
  }
  const hostOf = (/** @type {Room} */ room) => room.players.keys().next().value ?? null
  const info = (/** @type {Player} */ p) => ({ id: p.id, name: p.name, state: p.state })

  const leave = (/** @type {Player} */ player) => {
    const room = player.room
    if (!room) return
    player.room = null
    room.players.delete(player.id)
    if (room.players.size === 0) rooms.delete(room.name)
    else for (const other of room.players.values()) send(other, { t: 'leave', id: player.id, host: hostOf(room) })
  }

  wss.on('connection', (socket) => {
    /** @type {Player} */
    const player = { id: String(nextId++), name: '', state: null, socket, room: null, alive: true }
    connected.set(socket, player)
    socket.on('pong', () => (player.alive = true))
    socket.on('close', () => {
      connected.delete(socket)
      leave(player)
    })
    socket.on('message', (raw, isBinary) => {
      let message
      try {
        message = isBinary ? null : JSON.parse(raw.toString())
      } catch {
        message = null
      }
      if (!message || typeof message !== 'object') return send(player, { t: 'error', message: 'Messages must be JSON objects' })

      if (message.t === 'join') {
        if (player.room) return send(player, { t: 'error', message: 'Already in a room' })
        const name = String(message.room ?? '').slice(0, MAX_ROOM)
        if (!name) return send(player, { t: 'error', message: 'Missing room name' })
        let room = rooms.get(name)
        if (!room) rooms.set(name, (room = { name, players: new Map() }))
        if (room.players.size >= MAX_PLAYERS) return send(player, { t: 'error', message: `Room "${name}" is full` })
        player.name = String(message.name ?? '').slice(0, MAX_NAME) || `Player ${player.id}`
        const existing = [...room.players.values()].map(info)
        room.players.set(player.id, player)
        player.room = room
        send(player, { t: 'welcome', id: player.id, host: hostOf(room), players: [...existing, info(player)] })
        for (const other of room.players.values()) if (other !== player) send(other, { t: 'join', player: info(player) })
        return
      }

      const room = player.room
      if (!room) return send(player, { t: 'error', message: 'Join a room first' })
      if (message.t === 'msg') {
        const out = { t: 'msg', from: player.id, type: String(message.type ?? ''), data: message.data ?? null }
        if (message.to !== undefined) {
          const target = room.players.get(String(message.to))
          if (target) send(target, out)
        } else for (const other of room.players.values()) if (other !== player) send(other, out)
      } else if (message.t === 'state') {
        player.state = message.data ?? null
        for (const other of room.players.values()) if (other !== player) send(other, { t: 'state', from: player.id, data: player.state })
      }
    })
  })

  // Drops connections that stopped answering (closed laptops, lost Wi-Fi).
  const heartbeat = setInterval(() => {
    for (const [socket, player] of connected) {
      if (!player.alive) {
        socket.terminate()
        continue
      }
      player.alive = false
      socket.ping()
    }
  }, 30_000)

  return new Promise((resolve) => {
    http.listen(port, host, () => {
      const address = http.address()
      resolve({
        port: typeof address === 'object' && address ? address.port : port,
        close: () =>
          new Promise((done) => {
            clearInterval(heartbeat)
            for (const socket of wss.clients) socket.terminate()
            wss.close()
            http.close(() => done(undefined))
          }),
      })
    })
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { port } = await startRelay({ port: Number(process.env.PORT) || 8787 })
  console.log(`Game relay listening on ws://localhost:${port}`)
}
