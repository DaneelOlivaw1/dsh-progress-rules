// The registration id IS the package name: dsh-client-modules composes one boot
// graph row per active Loader entry's resolved package (`graphRow(packageName, …)`)
// and only strips a trailing `/client` from a registration id, so any other id
// (e.g. a `-client` suffix) leaves the row unregistered and aborts web boot.
if (typeof window !== 'undefined') window.__ModuleLoader__.load({
  id: 'dsh-progress-rules',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const jsx = require('react/jsx-runtime')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    // The plugin's Loader entry id doubles as the settings namespace.
    const ENTRY = 'progress-rules'
    const NS = 'settings.progressRules'

    // Only the copy lives here; the fields themselves come from the plugin's
    // `.volatile()` Config schema, so adding a config field needs no page change
    // beyond one label pair.
    const LABELS = {
      en: {
        title: 'Progress rules',
        description: 'Make the agent narrate progress between tool steps.',
        everySteps: 'Reminder interval',
        failOnSilent: 'Hard gate',
        enforce: 'Enabled',
        reminder: 'Reminder text',
        gateMessage: 'Gate failure text',
        text: 'Prompt section',
        name: 'Section name',
        order: 'Section order',
        overridden: 'Overridden',
        reset: 'Reset to default',
        readOnly: 'This deployment stores settings read-only.',
        unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
        save: 'Save',
        saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
        invalidNumber: 'Enter a number, or leave blank to use the default.',
      },
      zh: {
        title: '过程纪律',
        description: '让 agent 在工具步骤之间通报进展。',
        everySteps: '提醒间隔',
        failOnSilent: '硬闸',
        enforce: '启用',
        reminder: '提醒文本',
        gateMessage: '硬闸失败文本',
        text: '提示词段落',
        name: '段落名',
        order: '段落顺序',
        overridden: '已覆盖',
        reset: '恢复默认',
        readOnly: '本部署的设置为只读。',
        unavailable: '该插件当前未加载，暂时无法配置。',
        save: '保存',
        saveFailed: '本部署没有接受这些值，已保留供你修改。',
        invalidNumber: '请填数字；留空表示使用默认值。',
      },
    }

    const FIELDS = ['enforce', 'everySteps', 'failOnSilent', 'reminder', 'gateMessage', 'text', 'name', 'order']

    function ProgressRulesCard(props) {
      const t = props.t
      const state = props.useProgressRulesCard((snapshot) => snapshot)
      if (props.view === 'summary') return t('description')
      const field = (name, extra) => jsx.jsx(primitives.SettingsValueField, {
        id: `plugin-config-progress-rules-${name}`,
        label: t(name),
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        disabled: !state.writable,
        ...state[name],
        onEdit: (text) => props.edit(name, text),
        onReset: () => props.resetField(name),
        ...extra,
      })
      return jsx.jsx(primitives.SettingsForm, {
        labels: { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed') },
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

    const inject = ['slots', 'locale', 'configForms']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, LABELS), 'progress-rules: dictionaries')
      const t = ctx.locale.bind(NS)
      const form = new primitives.SettingsFormModel(ctx.configForms.get(ENTRY), [
        primitives.settingsNumberField('everySteps'),
        primitives.settingsTextField('enforce'),
        primitives.settingsTextField('failOnSilent'),
        primitives.settingsTextField('reminder'),
        primitives.settingsTextField('gateMessage'),
        primitives.settingsTextField('text'),
        primitives.settingsTextField('name'),
        primitives.settingsNumberField('order'),
      ])
      const store = form.bind(() => {
        const snapshot = { ...form.shell() }
        for (const name of FIELDS) snapshot[name] = form.field(name)
        return snapshot
      })
      ctx.effect(() => () => form.dispose(), 'progress-rules: form subscription')
      ctx.effect(() => ctx.configForms.whileServed([ENTRY], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item',
        id: 'progress-rules',
        order: 60,
        label: () => t('title'),
        locale: NS,
        inject: () => ({ t, hooks: { progressRulesCard: store }, ...form.actions() }),
      }, ProgressRulesCard))), 'progress-rules: page')
    }

    exports.NS = NS
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
