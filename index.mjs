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
import z from '@deepseek-ai/schemastery'

/** Default section order: after WEB_SURFACE (10100), before persona suffix (10200). */
export const DEFAULT_ORDER = 10150

/** Default number of consecutive silent steps before a reminder or gate fires. */
export const DEFAULT_EVERY_STEPS = 3

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

/** Default system-prompt section: the process rules themselves. */
export const DEFAULT_TEXT = `## 过程纪律（优先于其他风格偏好）

1. 长程任务必须逐步通报。每完成一个明确步骤、或结束一轮探索后，在发起下一次工具调用前，先用 1–3 句正文说明：刚做了什么、得到什么结论、下一步做什么。不要把多个步骤攒到最后一次性汇报，也不要用工具调用代替通报；单个小步骤或纯读取可以合并进同一段通报。

2. 不确定就问，不要猜。出现以下情况必须先调用 ask_user_question 再动手：(a) 需求有歧义，存在多种合理实现方向；(b) 需要用户偏好或业务背景才能决定；(c) 仓库与文档里查不到、且猜错代价高的关键事实。只读探索可以自主进行，用来把问题问得更准；但不得用"先猜一个再改"来替代提问。一次问清，给出可选项并附推荐。

3. 硬闸：连续沉默步数攒满后，下一次工具调用会直接失败（返回 Error），工具不会执行。看到失败就先补 1–3 句正文，再原样重试那次调用。一直不说话就一直失败，不会被放过。`

/** Cordis plugin name used by loader diagnostics. */
export const name = 'progress-rules'

/** The prompt registry this plugin contributes to, plus the tool registry for the hard gate. */
export const inject = ['systemPrompt', 'tools']

/**
 * Runtime schema for the plugin config.
 *
 * Every field is `.volatile()`, which is what puts it on the settings page: the
 * settings service derives one form per plugin from these declarations and
 * writes edits back to the profile patch. Fields left undefined fall back to the
 * defaults in `apply`, so an empty row is a valid row.
 */
export const Config = z.object({
  /** Consecutive silent steps before a reminder is injected. */
  everySteps: z.number().step(1).min(1).default(DEFAULT_EVERY_STEPS).volatile(),
  /** Fail the next tool call instead of only reminding. */
  failOnSilent: z.boolean().default(false).volatile(),
  /** Turn off both the reminder and the gate; the prompt section stays. */
  enforce: z.boolean().default(true).volatile(),
  /** Inject the narration reminder before a silent step. Off keeps only the gate. */
  nudge: z.boolean().default(true).volatile(),
  /** Reminder text injected before a silent step; empty string turns it off. */
  reminder: z.string().default(DEFAULT_REMINDER).volatile(),
  /** Tool-failure reason returned by the hard gate. */
  gateMessage: z.string().default(DEFAULT_GATE_MESSAGE).volatile(),
  /** System-prompt section text; empty string registers no section. */
  text: z.string().default(DEFAULT_TEXT).volatile(),
  /** Prompt section name. */
  name: z.string().default('user:progress-rules').volatile(),
  /** Prompt section order. */
  order: z.number().default(DEFAULT_ORDER).volatile(),
})

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
 * The nearest assistant message above the current step, with the two facts the
 * gate needs: whether it carried text, and its (turn, step) key.
 * @param agent - the agent the step belongs to.
 * @returns `{ silent, key }`, or undefined when no assistant message is found.
 */
export function lastAssistantEvent(agent) {
  const session = agent?.session
  const surface = session?.surface
  if (surface === undefined || !Array.isArray(surface.nodes)) return undefined
  for (let index = surface.nodes.length - 1; index >= 0; index -= 1) {
    const event = session.eventAt(surface.nodes[index])
    if (event === undefined) continue
    if (event.type !== 'assistant/message') continue
    const content = event.data?.message?.content
    if (!Array.isArray(content)) return undefined
    const silent = !content.some(block => (
      block?.type === 'text' && String(block.text ?? '').trim() !== ''
    ))
    return { silent, key: `${event.data?.turn ?? '?'}:${event.data?.step ?? '?'}` }
  }
  return undefined
}

/**
 * Read one config field. Volatile fields arrive as subscribable references, so
 * unwrap a reference and fall back to the given default when it is empty.
 * @param field - the resolved field, possibly a reference.
 * @param fallback - value to use when the field resolves to null/undefined.
 * @returns the plain value.
 */
function read(field, fallback) {
  const value = typeof field?.get === 'function' ? field.get() : field
  return value ?? fallback
}

/**
 * Register the prompt section, the per-step narration nudge and the hard gate.
 * @param ctx - plugin context.
 * @param config - resolved {@link Config}; every field carries its schema default.
 */
export function apply(ctx, config) {
  // The settings page is optional: a profile without the settings service keeps
  // running the plugin from its row config alone.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  const text = String(read(config.text, DEFAULT_TEXT))
  if (text.trim() !== '') {
    ctx.effect(
      () => ctx.systemPrompt.section({
        name: String(read(config.name, 'user:progress-rules')),
        order: Number(read(config.order, DEFAULT_ORDER)),
        text,
      }),
      'progress-rules.section()',
    )
  }

  const enforce = read(config.enforce, true) !== false
  const nudge = read(config.nudge, true) !== false
  const reminder = String(read(config.reminder, DEFAULT_REMINDER)).trim()
  const everySteps = Math.max(1, Math.trunc(Number(read(config.everySteps, DEFAULT_EVERY_STEPS))))
  const failOnSilent = read(config.failOnSilent, false) === true
  const gateMessage = String(read(config.gateMessage, DEFAULT_GATE_MESSAGE)).trim()
  // Consecutive silent steps, keyed by session object. Both the reminder and the
  // gate read this counter: `everySteps` is how many silent steps in a row are
  // tolerated before the next reminder fires, or before the gate fails a call.
  const silentRun = new WeakMap()
  // Sessions whose previous tool batch was just gated off, keyed by session object.
  // The failure already carries the instruction, so no reminder rides along with it.
  const gatedLast = new WeakSet()
  // The (turn, step) key whose batch the gate already denied, so the rest of the
  // same parallel batch fails too instead of slipping through a reset counter.
  const gatedStep = new WeakMap()

  // The counter must advance even in a gate-only setup (`nudge` off), because the
  // gate below reads it. Nudge injection is the only part that `nudge` controls.
  if (enforce) {
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
      if (!nudge || reminder === '' || run < everySteps) {
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
  }

  if (!enforce || !failOnSilent || gateMessage === '') return
  // The gate is a monotonic denial on the global guard layer. It stays off for
  // delegated agents: a child reports to its parent, not to the user.
  // It fires once `everySteps` silent steps have piled up, so short bursts of
  // tool calls stay legal and only a long silent run is stopped.
  ctx.effect(() => ctx.tools.guard((exec) => {
    const agent = exec.agent
    if (agent === undefined || agent.parentAgent !== undefined) return
    if (GATE_EXEMPT_TOOLS.has(exec.name)) return
    const session = agent.session
    if (session === undefined) return
    // Judge the message that issued this batch, not the counter advanced before
    // the model spoke: otherwise a step that narrates and then calls a tool
    // inherits the silence of the steps before it and is denied anyway.
    const last = lastAssistantEvent(agent)
    if (last === undefined) return
    if (last.silent) {
      if (gatedLast.has(session) && gatedStep.get(session) === last.key) return gateMessage
      if ((silentRun.get(session) ?? 0) < everySteps) return
      silentRun.set(session, 0)
      gatedLast.add(session)
      gatedStep.set(session, last.key)
      return gateMessage
    }
    silentRun.set(session, 0)
    return undefined
  }), 'progress-rules.gate()')
}
