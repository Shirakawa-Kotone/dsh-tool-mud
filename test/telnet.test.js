import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTelnetStream, IAC, stripAnsi, normalizeNewlines, DO, DONT, WILL, WONT, SB, SE } from '../src/telnet.js'

test('passes plain bytes through untouched', () => {
  const stream = createTelnetStream()
  assert.equal(stream.push(Buffer.from('你好\r\n')).toString('utf8'), '你好\r\n')
})

test('refuses a DO with WONT and a WILL with DONT', () => {
  const replies = []
  const stream = createTelnetStream({ reply: (bytes) => replies.push([...bytes]) })
  stream.push(Buffer.from([IAC, DO, 3, 1, 2]))
  stream.push(Buffer.from([IAC, WILL, 1]))
  assert.deepEqual(replies, [[IAC, WONT, 3], [IAC, DONT, 1]])
})

test('unescapes a doubled IAC', () => {
  const stream = createTelnetStream()
  assert.deepEqual([...stream.push(Buffer.from([IAC, IAC]))], [IAC])
})

test('drops a subnegotiation block', () => {
  const stream = createTelnetStream()
  const bytes = Buffer.concat([
    Buffer.from('a'),
    Buffer.from([IAC, SB, 24, 1, 2, 3, IAC, SE]),
    Buffer.from('b'),
  ])
  assert.equal(stream.push(bytes).toString(), 'ab')
})

test('keeps a negotiation split across chunks', () => {
  const replies = []
  const stream = createTelnetStream({ reply: (bytes) => replies.push([...bytes]) })
  // IAC arrives alone, the rest in the next chunk.
  assert.equal(stream.push(Buffer.from([IAC])).length, 0)
  assert.equal(stream.pendingBytes, 1)
  assert.equal(stream.push(Buffer.from([DO, 3])).length, 0)
  assert.deepEqual(replies, [[IAC, WONT, 3]])
})

test('keeps a split subnegotiation across chunks', () => {
  const stream = createTelnetStream()
  const head = Buffer.from([IAC, SB, 24, 1, 2])
  assert.equal(stream.push(head).length, 0)
  assert.equal(stream.push(Buffer.from([IAC, SE])).length, 0)
  assert.equal(stream.push(Buffer.from('x')).toString(), 'x')
})

test('strips colour codes and carries a partial escape', () => {
  assert.equal(stripAnsi('\x1b[1;32m气血\x1b[0m').text, '气血')
  const first = stripAnsi('a\x1b[1')
  assert.equal(first.text, 'a')
  assert.equal(first.carry, '\x1b[1')
  const second = stripAnsi(first.carry + ';32mb')
  assert.equal(second.text, 'b')
})

test('normalizes CRLF and bare CR', () => {
  assert.equal(normalizeNewlines('a\r\nb\rc'), 'a\nb\nc')
})
