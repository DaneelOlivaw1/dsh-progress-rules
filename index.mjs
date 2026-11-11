/**
 * DSH bundle plugin: make agents narrate progress between tool steps.
 *
 * Two layers:
 *
 * 1. System prompt (every request): one user-authored section with the
 *    process rules. This is advisory — a model may still run many tool steps
 *    without emitting prose.
 * 2. Deterministic nudge (`agent/pre-step`): when the previous step produced
 *    an assistant message with tool calls but no text, the next admitted step
 *    carries a user-role reminder telling the model to narrate first. This is
 *    what actually stops the "dozens of silent steps" pattern, because the
 *    harness injects it on every silent step instead of relying on the model
 *    to remember a system-prompt rule.
 *
 * Why a plugin instead of `system-prompt` row config or AGENTS.md:
 * - `system-prompt.personaSuffix` is shadowed by an agent preset's
 *   `@deepseek-ai/dsh-persona` row (which registers the same section name with
 *   an empty suffix), so shipped presets hide it.
 * - AGENTS.md is injected as an ordinary user message in conversation history,
 *   so compaction can summarize it away on long tasks.
 */

import { randomUUID } from 'node:crypto'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'progress-rules'

/** The prompt registry this plugin contributes to, plus the tool registry for the hard gate. */
export const inject = ['systemPrompt', 'tools']

/** Default section order: after WEB_SURFACE (10100), before persona suffix (10200). */
export const DEFAULT_ORDER = 10150

/** Default number of consecutive silent steps before a reminder is injected. */
export const DEFAULT_EVERY_STEPS = 5

/**
 * Tools exempt from the hard gate. `ask_user_question` and `present` are not
 * progress steps: the first ends the turn on its own, the second hands the
 * user a deliverable. Failing them just forces a pointless retry.
 */
export const GATE_EXEMPT_TOOLS = new Set(['ask_user_question', 'present'])

/** Default reminder injected before a silent step. */
export const DEFAULT_REMINDER =
  '（过程纪律提醒）上一步只执行了工具、没有输出正文。'
  + '现在先用 1–3 句正文向用户说明：刚做了什么、得到什么结论、下一步做什么；然后再继续。'

/** Default tool-failure reason returned by the hard gate. */
export const DEFAULT_GATE_MESSAGE =
  '过程纪律：上一步只调用了工具、没有输出正文，本次调用未执行。'
  + '先输出 1–3 句正文（刚做了什么、得到什么结论、下一步做什么），再重新发起本次调用。'

/**
 * Whether the most recent assistant message before the current step carried
 * no text block (tool-call/reasoning only).
 * @param agent - the agent the step belongs to.
 * @returns true when the last assistant turn was silent.
 */
export function lastStepWasSilent(agent) {
  const session = agent?.session
  const surface = session?.surface
  if (surface === undefined || !Array.isArray(surface.nodes)) return false
  for (let index = surface.nodes.length - 1; index >= 0; index -= 1) {
    const event = session.eventAt(surface.nodes[index])
    if (event === undefined) continue
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      if (!Array.isArray(content)) return false
      return !content.some(block => (
        block?.type === 'text' && String(block.text ?? '').trim() !== ''
      ))
    }
    // A user turn boundary above the nearest assistant message means the
    // assistant simply has not spoken yet in this turn.
    if (event.type === 'user/message' || event.type === 'turn/start') return false
  }
  return false
}

/**
 * Whether the step's assistant message before the current one carried no text.
 * Unlike {@link lastStepWasSilent} this walks past `user/message` boundaries
 * without resetting, because the reminder the plugin injects is itself a user
 * message: after a reminder the next step must still count as silent.
 * @param agent - the agent the step belongs to.
 * @returns true when the nearest assistant message above carried no text.
 */
export function stepBeforeWasSilent(agent) {
  const session = agent?.session
  const surface = session?.surface
  if (surface === undefined || !Array.isArray(surface.nodes)) return false
  for (let index = surface.nodes.length - 1; index >= 0; index -= 1) {
    const event = session.eventAt(surface.nodes[index])
    if (event === undefined) continue
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      if (!Array.isArray(content)) return false
      return !content.some(block => (
        block?.type === 'text' && String(block.text ?? '').trim() !== ''
      ))
    }
  }
  return false
}

/**
 * Register the prompt section, the per-step narration nudge and the hard gate.
 * @param ctx - plugin context.
 * @param config - `{ text?, name?, order?, reminder?, enforce?, failOnSilent? }`.
 */
export function apply(ctx, config = {}) {
  const text = config.text ?? ''
  const section = config.name ?? 'user:progress-rules'
  const order = config.order ?? DEFAULT_ORDER
  if (text.trim() !== '') {
    ctx.effect(
      () => ctx.systemPrompt.section({ name: section, order, text }),
      'progress-rules.section()',
    )
  }

  if (config.enforce === false) return
  const reminder = (config.reminder ?? DEFAULT_REMINDER).trim()
  if (reminder === '') return
  const everySteps = Math.max(1, Math.trunc(config.everySteps ?? DEFAULT_EVERY_STEPS))
  const failOnSilent = config.failOnSilent === true
  const gateMessage = (config.gateMessage ?? DEFAULT_GATE_MESSAGE).trim()
  // Consecutive silent steps since the last reminder, keyed by session object.
  const silentRun = new WeakMap()
  // Sessions whose previous tool batch was just gated off, keyed by session object.
  // The failure already carries the instruction, so no reminder rides along with it.
  const gatedLast = new WeakSet()

  ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal?.aborted) return decision
    const session = agent?.session
    if (session === undefined) return decision
    if (step <= 1) {
      silentRun.set(session, 0)
      return decision
    }
    if (!lastStepWasSilent(agent)) {
      silentRun.set(session, 0)
      return decision
    }
    if (gatedLast.has(session)) {
      gatedLast.delete(session)
      silentRun.set(session, 0)
      return decision
    }
    const run = (silentRun.get(session) ?? 0) + 1
    if (run < everySteps) {
      silentRun.set(session, run)
      return decision
    }
    silentRun.set(session, 0)
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: reminder }],
      source: {
        kind: 'progress-rules',
        form: 'notice',
        summary: '过程纪律：要求正文通报',
      },
    }
    return { ...decision, messages: [...decision.messages, message] }
  })

  if (!failOnSilent || gateMessage === '') return
  // The gate is a monotonic denial on the global guard layer. It stays off for
  // delegated agents: a child reports to its parent, not to the user.
  ctx.effect(() => ctx.tools.guard((exec) => {
    const agent = exec.agent
    if (agent === undefined || agent.parentAgent !== undefined) return
    if (GATE_EXEMPT_TOOLS.has(exec.name)) return
    if (!stepBeforeWasSilent(agent)) return
    if (agent.session !== undefined) gatedLast.add(agent.session)
    return gateMessage
  }), 'progress-rules.gate()')
}
