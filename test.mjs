import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, GATE_EXEMPT_TOOLS, DEFAULT_EVERY_STEPS } from './index.mjs'

const CFG = {
  enforce: true,
  nudge: false,
  everySteps: 3,
  failOnSilent: true,
  reminder: 'REMIND',
  gateMessage: 'GATE',
  text: '',
  name: 'user:test',
  order: 1,
}

const reasoning = { type: 'reasoning', text: 'thinking' }
const call = name => ({ type: 'tool-call', name, input: {} })
const text = value => ({ type: 'text', text: value })

/** Minimal harness: a session whose surface is an append-only list of events. */
function harness(config = CFG) {
  const events = new Map()
  let seq = 0
  const session = {
    surface: { nodes: [] },
    eventAt(node) { return events.get(node) },
  }
  const append = event => {
    const node = `n${++seq}`
    events.set(node, event)
    session.surface.nodes.push(node)
    return node
  }
  const agent = { session, parentAgent: undefined }
  let preStep
  let guard
  const promptSections = []
  const ctx = {
    inject() {},
    effect(fn) { fn() ; return () => {} },
    systemPrompt: { section(section) { promptSections.push(section); return () => {} } },
    on(name, handler) { if (name === 'agent/pre-step') preStep = handler },
    tools: { guard(fn) { guard = fn; return () => {} } },
  }
  apply(ctx, { ...config })
  return {
    agent,
    session,
    promptSections,
    /** Admit step `step`, then append its assistant message (what the model produced). */
    async step(step, blocks) {
      const decision = await preStep(
        { agent, step, signal: undefined },
        async () => ({ kind: 'accept', messages: [] }),
      )
      append({ type: 'assistant/message', data: { turn: 1, step, message: { content: blocks } } })
      return decision
    },
    gate(name = 'bash') { return guard === undefined ? undefined : guard({ agent, name }) },
  }
}

test('silent steps are tolerated until the threshold, then the batch is denied', async () => {
  const h = harness()
  await h.step(1, [reasoning, call('bash')])
  assert.equal(h.gate(), undefined)
  await h.step(2, [reasoning, call('bash')])
  assert.equal(h.gate(), undefined)
  await h.step(3, [reasoning, call('bash')])
  assert.equal(h.gate(), undefined)
  await h.step(4, [reasoning, call('bash')])
  assert.equal(h.gate(), CFG.gateMessage)
})

test('a step that narrates is never denied, even after a silent run', async () => {
  const h = harness()
  for (const step of [1, 2, 3]) {
    await h.step(step, [reasoning, call('bash')])
    assert.equal(h.gate(), undefined)
  }
  await h.step(4, [reasoning, text('我查完了，现在读日志'), call('read')])
  assert.equal(h.gate('read'), undefined)
})

test('narration resets the run, so the next silent step is not denied', async () => {
  const h = harness()
  for (const step of [1, 2, 3]) await h.step(step, [reasoning, call('bash')])
  await h.step(4, [reasoning, text('说话'), call('read')])
  assert.equal(h.gate('read'), undefined)
  await h.step(5, [reasoning, call('read')])
  assert.equal(h.gate('read'), undefined)
})

test('every call of the denied batch fails, not only the first', async () => {
  const h = harness()
  for (const step of [1, 2, 3]) await h.step(step, [reasoning, call('bash')])
  await h.step(4, [reasoning, call('read'), call('read')])
  assert.equal(h.gate('read'), CFG.gateMessage)
  assert.equal(h.gate('read'), CFG.gateMessage)
})

test('exempt tools bypass the gate', async () => {
  const h = harness()
  for (const step of [1, 2, 3]) await h.step(step, [reasoning, call('bash')])
  await h.step(4, [reasoning, call('bash')])
  for (const name of GATE_EXEMPT_TOOLS) assert.equal(h.gate(name), undefined)
})

test('delegated agents are never gated', async () => {
  const h = harness()
  h.agent.parentAgent = { id: 'parent' }
  for (const step of [1, 2, 3]) await h.step(step, [reasoning, call('bash')])
  await h.step(4, [reasoning, call('bash')])
  assert.equal(h.gate(), undefined)
})

test('the gate stays off when failOnSilent is false', async () => {
  const h = harness({ ...CFG, failOnSilent: false })
  for (const step of [1, 2, 3]) await h.step(step, [reasoning, call('bash')])
  await h.step(4, [reasoning, call('bash')])
  assert.equal(h.gate(), undefined)
})

test('everySteps defaults to the documented value', () => {
  assert.ok(Number.isInteger(DEFAULT_EVERY_STEPS) && DEFAULT_EVERY_STEPS >= 1)
})
