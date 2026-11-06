import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectFullme, findLoginPrompt } from '../src/prompts.js'

const creds = { id: 'miaoxing', password: 'secret' }
const opts = { encodingMenu: '2' }

test('answers the encoding menu', () => {
  const prompt = findLoginPrompt('Input 1 for GBK, 2 for UTF8, 3 for BIG5\r\n', 0, creds, opts)
  assert.equal(prompt.key, 'encoding')
  assert.equal(prompt.value, '2')
})

test('answers both wording variants of the id prompt', () => {
  for (const text of ['您的英文名字（要注册新人物请输入new。）：', '您的英文名字：']) {
    const prompt = findLoginPrompt(text, 0, creds, opts)
    assert.equal(prompt.key, 'id')
    assert.equal(prompt.value, 'miaoxing')
  }
})

test('answers the password prompt', () => {
  const prompt = findLoginPrompt('请输入您的密码：', 0, creds, opts)
  assert.equal(prompt.key, 'password')
  assert.equal(prompt.value, 'secret')
})

test('picks the earliest prompt in the buffer, not the first pattern that matches', () => {
  const text = '您的英文名字：\n请输入您的密码：'
  const prompt = findLoginPrompt(text, 0, creds, opts)
  assert.equal(prompt.key, 'id')
})

test('resumes scanning after the cursor', () => {
  const text = '您的英文名字：'
  const first = findLoginPrompt(text, 0, creds, opts)
  assert.equal(first.key, 'id')
  assert.equal(findLoginPrompt(text, first.end, creds, opts), null)
})

test('a missing credential becomes an empty answer instead of "undefined"', () => {
  const prompt = findLoginPrompt('请输入您的密码：', 0, { id: 'miaoxing' }, opts)
  assert.equal(prompt.value, '')
})

test('detects the fullme request the live server sends', () => {
  assert.equal(detectFullme('http://fullme.pkuxkx.net/robot.php?filename=179397480154412'), true)
  assert.equal(detectFullme('还是用这个命令，指令格式: fullme 验证码'), true)
})

test('does not treat the activity reminder as a pending captcha', () => {
  assert.equal(detectFullme('请注意，你的活跃度已经偏低。exp 5M以前，你可以使用fullme每15分钟补满全部状态，double内力。'), false)
})
