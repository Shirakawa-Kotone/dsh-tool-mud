import { EventEmitter } from 'node:events'

/** A stand-in for a `net.Socket` that records what the session writes. */
export function fakeSocket() {
  const socket = new EventEmitter()
  socket.destroyed = false
  socket.writes = []
  socket.write = (chunk) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
    socket.writes.push(text)
    socket.emit('written', text)
    return true
  }
  socket.destroy = () => {
    if (socket.destroyed) return
    socket.destroyed = true
    socket.emit('close')
  }
  return socket
}

/**
 * A `createConnection` replacement that hands back fake sockets in creation order.
 * Call `connect(socket)` to deliver the TCP `connect` event.
 */
export function fakeConnector() {
  const sockets = []
  const createConnection = (options) => {
    const socket = fakeSocket()
    socket.options = options
    sockets.push(socket)
    return socket
  }
  return {
    createConnection,
    sockets,
    get last() {
      return sockets[sockets.length - 1]
    },
  }
}

export const tick = () => new Promise((resolve) => setImmediate(resolve))

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
