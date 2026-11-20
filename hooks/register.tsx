import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Shown } from '../types'

const images = atom({ plugin: 'image-band', key: 'images' } as const, [], { shape: 'images-1' })
const turn = atom({ plugin: 'image-band', key: 'turn' } as const, 0)
const opened = atom({ plugin: 'image-band', key: 'opened' } as const, null, { shape: 'opened-1' })

const PANE = 'image-band'
const FULL_ROWS = 6
const SHRUNK_ROWS = 3
const SHRUNK_KEPT = 8
const CONVERTED_MAX_PX = 1600
const IMAGE_EXT = /\.(png|jpe?g|webp|heic|heif|gif|tiff?|bmp)$/i
const IMAGE_PATH_IN_TEXT = /\/[^\s'"`<>()[\]{},;|]+\.(?:png|jpe?g|webp|heic|heif|gif|tiff?|bmp)\b/gi
const OWN_FILES = /^(\/private)?\/tmp\/image-band-/

const isImagePath = (path: string) => IMAGE_EXT.test(path) && !OWN_FILES.test(path)

const isPng = (path: string) => /\.png$/i.test(path)

const imagePathsIn = (text: string) => (text.match(IMAGE_PATH_IN_TEXT) ?? []).filter(isImagePath)

const baseName = (path: string) => path.split('/').at(-1) ?? path

const readSize = async ($: EngineInterface, path: string) => {
  const { exitCode, stdout } = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path])
  const width = Number(stdout.match(/pixelWidth: (\d+)/)?.[1])
  const height = Number(stdout.match(/pixelHeight: (\d+)/)?.[1])

  return exitCode === 0 && width > 0 && height > 0 ? { width, height } : undefined
}

// Shrinks only: sips -Z would also blow a small image up to the cap.
const shrinkArgs = (size: { width: number; height: number }) =>
  Math.max(size.width, size.height) > CONVERTED_MAX_PX ? ['-Z', String(CONVERTED_MAX_PX)] : []

const convertToPng = async (
  $: EngineInterface,
  path: string,
  size: { width: number; height: number },
  generation: number,
) => {
  const out = `/private/tmp/image-band-${generation}-${baseName(path).replace(/[^\w.-]/g, '_')}.png`
  const { exitCode } = await $.process.run(['sips', '-s', 'format', 'png', ...shrinkArgs(size), path, '--out', out])

  return exitCode === 0 ? out : undefined
}

const nextGeneration = async ($: EngineInterface) =>
  Math.max(0, ...(await read($, images)).map(one => one.generation)) + 1

// The current turn's images all stay; of the earlier ones, only the newest few.
const keepRecent = (list: Shown[], current: number) => {
  const earlier = list.filter(one => one.turn < current)
  const dropped = new Set(earlier.slice(0, -SHRUNK_KEPT))

  return list.filter(one => !dropped.has(one))
}

const show = async ($: EngineInterface, original: string) => {
  const size = await readSize($, original)
  if (!size) return

  const generation = await nextGeneration($)
  const png = isPng(original) ? original : await convertToPng($, original, size, generation)
  if (!png) return

  const current = await read($, turn)
  const shown: Shown = { original, png, ...size, generation, turn: current }
  await update($, images, list => keepRecent([...list.filter(one => one.original !== original), shown], current))
}

// The band never gets in the way of the tool: a failed show is dropped.
const quietly = (work: Promise<unknown>) => work.catch(() => undefined)

const showAll = async ($: EngineInterface, paths: string[]) => {
  for (const path of paths) await show($, path)
}

const columnsFor = ({ width, height }: Shown, rows: number, maxColumns: number) =>
  Math.max(1, Math.min(maxColumns, 255, Math.round((rows * 2 * width) / height)))

const rowsFor = ({ width, height }: Shown, columns: number, maxRows: number) =>
  Math.max(1, Math.min(maxRows, 255, Math.round((columns * height) / width / 2)))

// Newest turn first, full size; earlier turns after it, shrunk.
const inBandOrder = (list: Shown[], current: number) => [
  ...list.filter(one => one.turn === current),
  ...list.filter(one => one.turn < current),
]

const openInSidebar = async ($: EngineInterface, image: Shown) => {
  await update($, opened, () => image)
  await $.ui.open({ id: PANE, title: baseName(image.original) })
}

const openInPreview = ($: EngineInterface, image: Shown) => $.process.run(['open', image.original])

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    await quietly(update($, turn, n => n + 1))

    return next(e)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const ran = await next(e)
    if (!ran.deny && !ran.isError && isImagePath(e.file_path)) await quietly(show($, e.file_path))

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!ran.deny) await quietly(showAll($, imagePathsIn(ran.text ?? '')))

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, images)
    if (e.surface !== 'terminal' || e.props.hasSurvey || list.length === 0) return next(e)

    const { Box, Button, Image, Text } = $.ui.resolve(e)
    const current = await read($, turn)

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {inBandOrder(list, current).map((image, index) => {
          const rows = image.turn === current ? FULL_ROWS : SHRUNK_ROWS
          const columns = columnsFor(image, rows, e.props.bodyColumns)

          return (
            <Box key={`thumb-${image.original}`} flexDirection="column" width={columns}>
              <Image
                key={`image-${image.original}`}
                source={{ file: image.png, format: 'png', generation: image.generation }}
                columns={columns}
                rows={rows}
                alt={baseName(image.original)}
              />
              <Button
                key={`open-${image.original}`}
                plain
                hotkey={index < 9 ? String(index + 1) : undefined}
                onPress={() => openInSidebar($, image)}
              >
                <Text dimColor wrap="truncate-middle">{baseName(image.original)}</Text>
              </Button>
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)

    const { Box, Button, Image, Text } = $.ui.resolve(e)
    const image = await read($, opened)
    if (!image) return <Text dimColor>No image opened.</Text>

    const columns = Math.min(255, e.props.bodyColumns)
    const rows = rowsFor(image, columns, Math.max(1, e.props.scroll.bodyRows - 4))

    return (
      <Box flexDirection="column" gap={1}>
        <Image
          key="sidebar-image"
          source={{ file: image.png, format: 'png', generation: image.generation }}
          columns={columnsFor(image, rows, columns)}
          rows={rows}
          alt={baseName(image.original)}
        />
        <Text dimColor>
          {baseName(image.original)} · {image.width}×{image.height}
        </Text>
        <Box flexDirection="row" gap={2}>
          <Button key="preview" label="Open in Preview" onPress={() => openInPreview($, image)} />
          <Button key="close" label="Close" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
