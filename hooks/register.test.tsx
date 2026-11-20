import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'image-band',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 30,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 29 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'image-band',
  component: 'Pane',
  requestId: 'image-band',
  surface: 'terminal',
  props: {
    title: 'Image',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const ok = (stdout = '') => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const failed = { value: { exitCode: 1, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false } }

// Stands in for the host: sips reads every image as 800x400 (or as `sizes` says) unless `unreadable` names it.
const fakeHost = (on: any, unreadable: string[] = [], sizes: Record<string, string> = {}) => {
  const ran: string[][] = []
  const panes: string[] = []
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    ran.push([...e.argv])
    const path = e.argv.at(-1) ?? ''
    if (e.argv[1] === '-g') return unreadable.includes(path) ? failed : ok(`${path}\n  pixelWidth: ${(sizes[path] ?? '800x400').split('x')[0]}\n  pixelHeight: ${(sizes[path] ?? '800x400').split('x')[1]}\n`)
    return ok()
  })
  on('tool.call', (_: unknown, e: { tool: string; command?: string }) => ({
    result: {},
    text: e.tool === 'Bash' ? e.command : 'read',
  }))
  on('prompt.submit', (_: unknown, e: unknown) => e)
  on('ui.open', (_: unknown, e: { id: string }) => (panes.push(`open ${e.id}`), { value: { isPlaced: true } }))
  on('ui.close', (_: unknown, e: { id: string }) => (panes.push(`close ${e.id}`), { value: undefined }))
  return { ran, panes }
}

const read = ($: any, path: string) => $.tool.call({ tool: 'Read', file_path: path })

const sendPrompt = ($: any) => $.prompt.submit({ text: 'next' })

const sourceFile = (image: any) => (image.props.source as { file: string }).file

const bandImages = async ($: any): Promise<{ ui: any; images: any[] }> => {
  const ui = await $.ui.mount(BAND)
  const images = await ui.findAll({ type: 'Image' })
  return { ui, images }
}

test('every image of the current turn shows side by side, 6 rows, sized to its shape', async ($, on) => {
  fakeHost(on)
  await read($, '/a/one.png')
  await read($, '/a/two.png')

  const { ui, images } = await bandImages($)
  expect(images.map(sourceFile)).toEqual(['/a/one.png', '/a/two.png'])
  expect(images.map(i => [i.props.rows, i.props.columns])).toEqual([[6, 24], [6, 24]])
  expect((await ui.find({ type: 'Button', key: 'open-/a/one.png' }))?.text).toContain('one.png')
  await ui.unmount()
})

test('sending a prompt shrinks earlier images to 3 rows, keeping the 8 newest', async ($, on) => {
  fakeHost(on)
  for (let n = 1; n <= 10; n++) await read($, `/a/old${n}.png`)
  await sendPrompt($)
  await read($, '/a/new.png')

  const { ui, images } = await bandImages($)
  expect(images.map(sourceFile)).toEqual(['/a/new.png', ...[3, 4, 5, 6, 7, 8, 9, 10].map(n => `/a/old${n}.png`)])
  expect(images.map(i => i.props.rows)).toEqual([6, 3, 3, 3, 3, 3, 3, 3, 3])
  await ui.unmount()
})

test('reading an image again moves it to the newest spot', async ($, on) => {
  fakeHost(on)
  await read($, '/a/one.png')
  await read($, '/a/two.png')
  await read($, '/a/one.png')

  const { ui, images } = await bandImages($)
  expect(images.map(sourceFile)).toEqual(['/a/two.png', '/a/one.png'])
  await ui.unmount()
})

test('a jpg is converted with sips at its own size', async ($, on) => {
  const { ran } = fakeHost(on)
  await read($, '/a/photo.jpg')

  const convert = ran.find(argv => argv[0] === 'sips' && argv[1] === '-s')
  expect(convert?.slice(0, 5)).toEqual(['sips', '-s', 'format', 'png', '/a/photo.jpg'])
  const { ui, images } = await bandImages($)
  expect(sourceFile(images[0])).toBe(convert?.at(-1))
  await ui.unmount()
})

test('a jpg larger than 1600px is shrunk to 1600px as it converts', async ($, on) => {
  const { ran } = fakeHost(on, [], { '/a/big.jpg': '4000x3000' })
  await read($, '/a/big.jpg')

  const convert = ran.find(argv => argv[0] === 'sips' && argv[1] === '-s')
  expect(convert?.slice(0, 7)).toEqual(['sips', '-s', 'format', 'png', '-Z', '1600', '/a/big.jpg'])
})

test('Bash output: every image path is picked up, the band\'s own files are not', async ($, on) => {
  fakeHost(on)
  await $.tool.call({
    tool: 'Bash',
    command: 'saved /a/one.png\nthen "/a/two.png" /private/tmp/image-band-3-x.png /tmp/image-band-4-y.png',
  })

  const { ui, images } = await bandImages($)
  expect(images.map(sourceFile)).toEqual(['/a/one.png', '/a/two.png'])
  await ui.unmount()
})

test('a path sips cannot read, or a file that is not an image, is skipped', async ($, on) => {
  const { ran } = fakeHost(on, ['/a/gone.png'])
  await read($, '/a/gone.png')
  await read($, '/a/notes.ts')

  expect(ran).toHaveLength(1)
  const { ui, images } = await bandImages($)
  expect(images).toHaveLength(0)
  await ui.unmount()
})

test('pressing a filename opens the sidebar on that image', async ($, on) => {
  const { ran, panes } = fakeHost(on)
  await read($, '/a/one.png')
  await read($, '/a/photo.jpg')

  const band = await $.ui.mount(BAND)
  await band.press({ key: 'open-/a/one.png' })
  expect(panes).toEqual(['open image-band'])
  await band.unmount()

  const pane = await $.ui.mount(PANE)
  const image = await pane.find({ type: 'Image' })
  expect(sourceFile(image)).toBe('/a/one.png')
  expect(image?.props.columns).toBe(60)
  expect(image?.props.rows).toBe(15)
  expect((await pane.find({ type: 'Text', text: /one\.png/ }))?.text).toContain('800×400')

  await pane.press({ key: 'preview' })
  expect(ran.at(-1)).toEqual(['open', '/a/one.png'])
  await pane.press({ key: 'close' })
  expect(panes).toEqual(['open image-band', 'close image-band'])
  await pane.unmount()
})
