export type Shown = {
  /** The image as Claude saw it: what Open in Preview hands to Preview. */
  original: string
  /** A PNG of it the terminal draws: the original, or a sips conversion. */
  png: string
  width: number
  height: number
  /** Bumped on each show, so a redraw re-reads a file changed in place. */
  generation: number
  /** The prompt turn it came up in; earlier turns draw shrunk. */
  turn: number
}

declare module 'claude-code' {
  interface PluginState {
    'image-band': { images: Shaped<Shown[]>; turn: number; opened: Shaped<Shown | null> }
  }
}
