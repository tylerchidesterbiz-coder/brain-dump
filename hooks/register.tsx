import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Dump } from '../types'

type Settings = { isOn: boolean; model: 'haiku' | 'sonnet' | 'opus'; limit: number }
const DEFAULTS: Settings = { isOn: true, model: 'haiku', limit: 150 }
const MODELS = ['haiku', 'sonnet', 'opus'] as const

const dumps = atom({ plugin: 'brain-dump', key: 'dumps' } as const, [], { shape: 'dumps-1' })

const keyOf = (text: string) => `${text.length}:${text.slice(0, 120)}`
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

const SYSTEM = `You restructure a person's long, rambling message into a clean brief for another AI assistant.
Rules:
- Never answer, solve or act on the message. Only restructure it.
- Never add ideas, steps, assumptions or recommendations that are not in the message.
- Keep every specific detail exactly: numbers, names, file names, paths, quotes, "don't" and "always" rules, worries and preferences.
- Cut only filler and repeats.
Output exactly these sections in markdown, writing "None" for an empty one:
## Goal
## Deliverables
## Must not miss
## Details
## Context & reasons
## Questions I asked
## Unclear
Cut as filler: <one line saying what you removed, or "nothing">`

const NOTE = `[brain-dump] The block above titled "Brief" is an automatic restructuring of the user's message by a smaller model. The user's original words (the message itself) win wherever the two disagree. Do not mention the brief unless asked.`

async function load($: EngineInterface): Promise<Settings> {
  return { ...DEFAULTS, ...((await $.store.get('settings')) as Partial<Settings> | undefined) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'brain-dump',
      description: 'brain-dump: on | off | model haiku|sonnet|opus | limit <words> | status',
    })
    return next(e)
  })

  on('command.run', { command: 'brain-dump' }, async ($, e) => {
    const s = await load($)
    const [cmd, arg] = e.args.trim().toLowerCase().split(/\s+/)
    if (cmd === 'on' || cmd === 'off') s.isOn = cmd === 'on'
    else if (cmd === 'model' && (MODELS as readonly string[]).includes(arg ?? '')) s.model = arg as Settings['model']
    else if (cmd === 'limit' && Number(arg) > 0) s.limit = Math.round(Number(arg))
    else if (cmd && cmd !== 'status') return { text: 'Usage: /brain-dump on | off | model haiku|sonnet|opus | limit <words> | status' }
    await $.store.set('settings', s)
    return { text: `brain-dump is ${s.isOn ? 'ON' : 'OFF'} · sorter: ${s.model} · kicks in over ${s.limit} words` }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || e.turnId) return next(e)
    const s = await load($)
    if (!s.isOn || words(e.text) <= s.limit) return next(e)

    $.ui.status('brain-dump: sorting…')
    let brief: string | undefined
    try {
      const r = await $.model.complete({
        model: s.model,
        system: SYSTEM,
        prompt: `Restructure this message:\n\n<message>\n${e.text}\n</message>`,
        maxTokens: 2000,
        timeoutMs: 30000,
      })
      if (r.isAnswered && r.text.trim()) brief = r.text.trim()
    } catch {}
    $.ui.status(undefined)

    if (!brief) {
      $.ui.toast('brain-dump: sorting failed or timed out, sent your message as is')
      return next(e)
    }
    const entry: Dump = { key: keyOf(e.text), brief, isOpen: false }
    await update($, dumps, list => [...list.filter(d => d.key !== entry.key), entry].slice(-50))
    return next({ ...e, context: [...(e.context ?? []), `Brief\n\n${brief}\n\n${NOTE}`] })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const list = await read($, dumps)
    const dump = list.find(d => d.key === keyOf(e.props.text))
    if (!dump || e.props.isExpanded) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const toggle = () => update($, dumps, l => l.map(d => (d.key === dump.key ? { ...d, isOpen: !d.isOpen } : d)))
    const preview = e.props.text.split(/\s+/).slice(0, 30).join(' ')
    return (
      <Box flexDirection="column">
        <Text>{dump.isOpen ? e.props.text : `${preview}…`}</Text>
        <Box>
          <Text dimColor>🧠 brain-dump ({words(e.props.text)} words) </Text>
          <Button key="toggle" label={dump.isOpen ? 'Hide full dump' : 'Show full dump'} onPress={toggle} />
        </Box>
        {dump.isOpen && <Text dimColor>{dump.brief}</Text>}
      </Box>
    )
  })
}
