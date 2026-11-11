window.__ModuleLoader__.load({
  id: 'dsh-progress-rules/client',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const jsx = require('react/jsx-runtime')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    // The plugin's own Loader entry id is the settings namespace.
    const NS_ENTRY = 'progress-rules'
    const NS = 'settings.progressRules'

    const en = {
      title: 'Progress rules',
      description: 'Make the agent narrate progress between tool steps.',
      everySteps: 'Reminder interval',
      everyStepsHint: 'Consecutive tool-only steps before a reminder is injected.',
      failOnSilent: 'Hard gate',
      failOnSilentHint: 'When on, a tool call after silent steps fails instead of only being reminded.',
      enforce: 'Enabled',
      enforceHint: 'Off keeps the prompt section but drops both the reminder and the gate.',
      reminder: 'Reminder text',
      reminderHint: 'Injected before a silent step. Empty turns the reminder off.',
      gateMessage: 'Gate failure text',
      gateMessageHint: 'The failure reason a gated tool call returns.',
      text: 'Prompt section',
      textHint: 'System-prompt rules. Empty registers no section.',
      name: 'Section name',
      nameHint: 'Prompt section identifier.',
      order: 'Section order',
      orderHint: '10100 is WEB_SURFACE, 10200 the persona suffix.',
      overridden: 'Overridden',
      reset: 'Reset to default',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      save: 'Save',
      saving: 'Saving…',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      invalidNumber: 'Enter a number, or leave blank to use the default.',
    }
    const zh = {
      title: '过程纪律',
      description: '让 agent 在工具步骤之间通报进展。',
      everySteps: '提醒间隔',
      everyStepsHint: '连续多少个只有工具的步骤后注入一次提醒。',
      failOnSilent: '硬闸',
      failOnSilentHint: '开启后，沉默之后的下一次工具调用会直接失败，而不只是提醒。',
      enforce: '启用',
      enforceHint: '关闭后保留提示词段落，但提醒和硬闸都不生效。',
      reminder: '提醒文本',
      reminderHint: '在沉默步骤前注入。留空关闭提醒。',
      gateMessage: '硬闸失败文本',
      gateMessageHint: '被闸拦下的工具调用返回的失败原因。',
      text: '提示词段落',
      textHint: '系统提示词里的规则。留空则不注册该段。',
      name: '段落名',
      nameHint: '提示词段落的标识。',
      order: '段落顺序',
      orderHint: '10100 是 WEB_SURFACE，10200 是 persona suffix。',
      overridden: '已覆盖',
      reset: '恢复默认',
      readOnly: '本部署的设置为只读。',
      unavailable: '该插件当前未加载，暂时无法配置。',
      save: '保存',
      saving: '保存中…',
      saveFailed: '本部署没有接受这些值，已保留供你修改。',
      invalidNumber: '请填数字；留空表示使用默认值。',
    }

    function formLabels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
      }
    }

    const FIELDS = [
      'everySteps',
      'failOnSilent',
      'enforce',
      'reminder',
      'gateMessage',
      'text',
      'name',
      'order',
    ]

    function ProgressRulesCard(props) {
      const { t } = props
      const state = props.useProgressRulesCard((snapshot) => snapshot)
      if (props.view === 'summary') return t('description')
      const field = (name, extra = {}) => jsx.jsx(primitives.SettingsValueField, {
        id: `plugin-config-progress-rules-${name}`,
        label: t(name),
        hint: t(`${name}Hint`),
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        disabled: !state.writable,
        ...state[name],
        onEdit: (text) => { props.edit(name, text) },
        onReset: () => { props.resetField(name) },
        ...extra,
      })
      return jsx.jsx(primitives.SettingsForm, {
        labels: formLabels(t),
        state,
        onSave: props.save,
        onDiscard: props.discard,
        children: [
          field('enforce'),
          field('everySteps', { numeric: true, invalidLabel: t('invalidNumber') }),
          field('failOnSilent'),
          field('reminder'),
          field('gateMessage'),
          field('text'),
          field('name'),
          field('order', { numeric: true, invalidLabel: t('invalidNumber') }),
        ],
      })
    }

    class ProgressRulesCardController {
      constructor(scope) {
        this.form = new primitives.SettingsFormModel(scope, [
          primitives.settingsNumberField('everySteps'),
          primitives.settingsTextField('failOnSilent'),
          primitives.settingsTextField('enforce'),
          primitives.settingsTextField('reminder'),
          primitives.settingsTextField('gateMessage'),
          primitives.settingsTextField('text'),
          primitives.settingsTextField('name'),
          primitives.settingsNumberField('order'),
        ])
        this.store = this.form.bind(() => this.projection())
      }

      projection() {
        const snapshot = { ...this.form.shell() }
        for (const name of FIELDS) snapshot[name] = this.form.field(name)
        return snapshot
      }

      inject() {
        return {
          hooks: { progressRulesCard: this.store },
          ...this.form.actions(),
        }
      }

      dispose() {
        this.form.dispose()
      }
    }

    const inject = ['slots', 'locale', 'configForms']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'progress-rules: dictionaries')
      const t = ctx.locale.bind(NS)
      const card = new ProgressRulesCardController(ctx.configForms.get(NS_ENTRY))
      ctx.effect(() => () => card.dispose(), 'progress-rules: form subscription')
      ctx.effect(() => ctx.configForms.whileServed([NS_ENTRY], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item',
        id: 'progress-rules',
        order: 60,
        label: () => t('title'),
        locale: NS,
        inject: () => card.inject(),
      }, ProgressRulesCard))), 'progress-rules: page')
    }

    exports.NS = NS
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
