# dsh-progress-rules

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) bundle plugin that
makes agents report progress instead of silently running dozens of tool steps.

English | [中文](README.zh.md)

## What it does

One bundle row mounts four independent mechanisms (two on the harness side, one gate, one page):

1. **System-prompt section** — `user:progress-rules` at order `10150` (after the Web surface
   section, before the deployment persona suffix). It carries your process-discipline rules and
   is re-rendered on every request, so conversation compaction can never summarize it away.
   It uses its own section name, so a preset's `@deepseek-ai/dsh-persona` row cannot shadow it
   the way it shadows the deployment `personaSuffix`.

2. **Deterministic nudge** — on every `agent/pre-step`, the plugin checks whether the previous
   assistant message contained any text block. If it only carried tool calls (or reasoning),
   that step counts as *silent*. After `everySteps` consecutive silent steps it injects one
   user-role reminder into the next admitted step: "you ran tools without reporting, narrate in
   1–3 sentences before continuing". The reminder is a durable context message rendered as a
   `progress-rules` context row, not as a message from the user. Any narrated step resets the
   counter.

The first layer is advisory for the model. The second layer is what actually breaks the
"40 silent steps" pattern, because the harness inserts the reminder itself instead of trusting
the model to remember a rule.

3. **Hard gate** (`failOnSilent`, on in the bundled patch) — once the silent run reaches
   `everySteps`, the *next* tool call of the main agent fails instead of running: the tool result
   is an `Error:` carrying `gateMessage`, so the model must narrate before it can retry. Subagents
   (`agent.parentAgent`), `ask_user_question`, and `present` are never gated. After a gated call
   no reminder is stacked on top — the failure text already states the requirement.

4. **Settings page** — the package is also a dual-face plugin (`dsh.client` + `exports["./client"]`),
   so the Web profile renders it under **Plugins → 过程纪律 (Progress rules)** with every field
   editable. Saving writes the row back to the profile's `cordis.patch.yml` and takes effect
   immediately. The page is mounted from the same Loader row, so no second row is needed.

## Install

DSH plugins are installed into a **profile** (`$DSH_HOME/profiles/<name>`), not globally:

```bash
cd ~/.dsh/profiles/web          # or tui / your own profile

# released versions of this fork are git tags
dsh plugin --profile web add dsh-progress-rules@github:DaneelOlivaw1/dsh-progress-rules#v0.3.1
# equivalent, if you drive the package manager yourself:
# npm install github:DaneelOlivaw1/dsh-progress-rules#v0.3.1
```

> The `dsh-progress-rules` name on the npm registry belongs to the upstream project
> ([`Adamaik/dsh-progress-rules`](https://github.com/Adamaik/dsh-progress-rules), latest `0.2.1`),
> so `npm install dsh-progress-rules` installs upstream *without* the hard gate and settings page.
> Fork versions install from a git tag, as above.

Then add the bundle to the profile's `package.json` (order matters: bundles compose in list
order, so put it after the base bundles):

```json
{
  "dependencies": {
    "dsh-progress-rules": "github:DaneelOlivaw1/dsh-progress-rules#v0.3.1"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-progress-rules"
      ]
    }
  }
}
```

Restart DSH afterwards. `dsh plugin` only installs the dependency; adding the **bundles** entry is
separate — the Web plugin page does it for you, otherwise edit `dsh.profile.bundles` by hand as
shown above.

## Configuration

The bundle patch (`cordis.patch.yml` inside this package) declares one row:

```yaml
- insert:
    - id: progress-rules
      name: dsh-progress-rules
      config:
        everySteps: 5
        text: |
          ## 过程纪律（优先于其他风格偏好）
          ...
```

Override it from the profile's `cordis.patch.yml` by targeting the same row id. Patch semantics
replace the **whole** row config, so restate every key you keep:

```yaml
- id: progress-rules
  name: dsh-progress-rules
  config:
    everySteps: 3
    text: |
      ## Process discipline
      1. Narrate progress after every step.
      2. Ask when uncertain instead of guessing.
```

| Key | Default | Meaning |
|---|---|---|
| `text` | bundled Chinese rules | System-prompt section text. Empty drops the section. |
| `name` | `user:progress-rules` | Section name. |
| `order` | `10150` | Section order (WEB_SURFACE is 10100, persona suffix 10200). |
| `enforce` | `true` | `false` disables the nudge and the gate, leaving only the prompt section. |
| `reminder` | bundled one-liner | Text injected before a silent step. Empty disables the nudge. |
| `everySteps` | `5` | Consecutive silent steps before one reminder. `1` = every step, larger = quieter. |
| `failOnSilent` | `false` in code, `true` in the bundled patch | Fail the next tool call instead of only reminding. |
| `gateMessage` | bundled Chinese text | Tool failure reason returned by the gate. Empty disables the gate. |

## Why not AGENTS.md or `personaSuffix`?

- **`AGENTS.md`** is loaded as a durable user message in conversation history. On long tasks DSH
  compaction may summarize it away; the system prompt is never compacted.
- **`system-prompt.personaSuffix`** is shadowed for preset sessions: the shipped Standard / PTC /
  Minimal presets mount `@deepseek-ai/dsh-persona`, which registers the same
  `deployment:persona-suffix` section with empty text, hiding the deployment value. A differently
  named section avoids that entirely.

## Compatibility

- Tested with DSH `0.2.2-rc.1` and `0.2.1-rc.2`, Standard preset, `deepseek-v4.1-flash:1017-cloud`.
- Plain ESM, no Cordis imports, no runtime dependencies; uses `node:crypto`.
- The nudge detects silence by checking text blocks in the last assistant message. A provider
  that reports assistant text in a custom block type would not be recognized — open an issue.

## Changelog

[CHANGELOG.md](CHANGELOG.md) — 0.3.1 fixes a Web boot failure where the client bundle registered
under the wrong module id.

## License

MIT
