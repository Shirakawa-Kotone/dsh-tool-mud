import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createJournal } from '../src/journal.js'
import { createNotes } from '../src/notes.js'

const at = () => new Date('2026-11-06T00:00:00Z')

test('splits a multi-line chunk into one entry per line', () => {
  const journal = createJournal({ now: at })
  journal.record('server', '第一行\n\n第二行\r\n')
  const page = journal.since(0)
  assert.deepEqual(page.entries.map((entry) => entry.text), ['第一行', '第二行'])
  assert.deepEqual(page.entries.map((entry) => entry.seq), [1, 2])
  assert.equal(page.cursor, 2)
})

test('since() returns only newer entries, and nothing at the head', () => {
  const journal = createJournal({ now: at })
  journal.record('server', 'a')
  journal.record('agent', 'hp')
  assert.deepEqual(journal.since(0).entries.map((entry) => entry.text), ['a', 'hp'])
  assert.deepEqual(journal.since(1).entries.map((entry) => entry.text), ['hp'])
  assert.deepEqual(journal.since(2).entries, [])
  assert.deepEqual(journal.since(99).entries, [])
})

test('keeps the newest entries only once the ring is full', () => {
  const journal = createJournal({ limit: 3, now: at })
  for (const line of ['1', '2', '3', '4', '5']) journal.record('server', line)
  assert.equal(journal.size, 3)
  assert.deepEqual(journal.since(0).entries.map((entry) => entry.text), ['3', '4', '5'])
})

test('carries the actor so the panel can tell the model from the human', () => {
  const journal = createJournal({ now: at })
  journal.record('agent', 'hp', { actor: 'model' })
  journal.record('agent', 'fullme 自己', { actor: 'human' })
  assert.deepEqual(journal.since(0).entries.map((entry) => entry.actor), ['model', 'human'])
})

test('clear() resets both entries and the cursor', () => {
  const journal = createJournal({ now: at })
  journal.record('server', 'x')
  journal.clear()
  assert.equal(journal.size, 0)
  assert.equal(journal.since(0).cursor, 0)
})

test('notes returns only the tail of a large file and flags truncation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mud-notes-tail-'))
  const plan = path.join(dir, 'plan.md')
  fs.writeFileSync(plan, 'A'.repeat(100) + 'TAIL')
  const { plan: read } = createNotes({ planPath: plan, maxChars: 10 }).read()
  assert.equal(read.text, 'AAAAAATAIL')
  assert.equal(read.truncated, true)
})

test('notes leaves an unconfigured section null', () => {
  assert.deepEqual(createNotes({}).read(), { plan: null, diary: null })
})
