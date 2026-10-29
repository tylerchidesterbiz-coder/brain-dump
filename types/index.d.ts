export type Dump = { key: string; brief: string; isOpen: boolean }

declare module 'claude-code' {
  interface PluginState {
    'brain-dump': { dumps: Shaped<Dump[]> }
  }
}
