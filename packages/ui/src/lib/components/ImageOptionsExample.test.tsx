import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageOptionsExample from './ImageOptionsExample'
import { getApiUrl } from '../utils'
import { IMAGE_OPTION_TILES, type ImageOptionTile } from '../utils/integration-examples'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tabs = () => screen.getAllByRole('tab')
const panel = () => screen.getByRole('tabpanel')

/** The logo the preview shows for the selected option, read from the preview's own image. */
const previewSources = () =>
  within(panel())
    .getAllByRole('img')
    .map((image) => image.getAttribute('src'))

/** Selects the option with this title, the way a reader does: by clicking its tab. */
function select(title: string) {
  fireEvent.click(screen.getByRole('tab', { name: title }))
}

/** A stand-in for the clipboard, which jsdom does not provide. */
function stubClipboard() {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  return writeText
}

describe('ImageOptionsExample, the tabs', () => {
  it('offers one tab per option, in the order the options are defined', () => {
    render(<ImageOptionsExample />)
    expect(tabs().map((tab) => tab.textContent)).toEqual(IMAGE_OPTION_TILES.map((tile) => tile.title))
  })

  it('selects the first option on load', () => {
    render(<ImageOptionsExample />)
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs()[1].getAttribute('aria-selected')).toBe('false')
  })

  it('labels the panel with the selected tab, and points each tab at that panel', () => {
    render(<ImageOptionsExample />)
    const selectedTab = tabs()[0]
    expect(panel().getAttribute('aria-labelledby')).toBe(selectedTab.id)
    for (const tab of tabs()) expect(tab.getAttribute('aria-controls')).toBe(panel().id)
  })

  it('leaves only the selected tab in the Tab order, as the tabs pattern asks', () => {
    render(<ImageOptionsExample />)
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1])
    select('Custom plate')
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, -1, 0])
  })
})

describe('ImageOptionsExample, the preview', () => {
  it.each(IMAGE_OPTION_TILES.map((tile) => [tile.title, tile] as const))(
    'shows the image and address of the %s option when its tab is selected',
    (title, tile: ImageOptionTile) => {
      render(<ImageOptionsExample />)
      select(title)

      expect(tab(title).getAttribute('aria-selected')).toBe('true')
      expect(within(panel()).getByText(title, { selector: 'p' })).toBeTruthy()
      for (const sample of tile.samples) {
        expect(previewSources()).toContain(getApiUrl(sample.path))
        expect(within(panel()).getByText(getApiUrl(sample.path)).closest('a')!.getAttribute('href')).toBe(
          getApiUrl(sample.path),
        )
      }
    },
  )

  it('shows the selected option only, so the page does not repeat every address', () => {
    render(<ImageOptionsExample />)
    select('Vector only')
    expect(within(panel()).queryByText(getApiUrl(IMAGE_OPTION_TILES[0].samples[0].path))).toBeNull()
    expect(previewSources()).toEqual([getApiUrl(IMAGE_OPTION_TILES[1].samples[0].path)])
  })

  it('draws the plain and the contrast logo side by side on the dark backdrop, with their captions', () => {
    render(<ImageOptionsExample />)
    select('Plate for a dark page')

    const [plain, contrast] = previewSources()
    expect(plain).toBe(getApiUrl('/image/eip155-25'))
    expect(contrast).toBe(getApiUrl('/image/eip155-25?contrast=dark'))
    expect(within(panel()).getByText('No options')).toBeTruthy()
    expect(within(panel()).getByText('contrast=dark', { selector: 'figcaption' })).toBeTruthy()
    const well = within(panel()).getAllByRole('img')[0].closest('.rounded-lg')!
    expect(well.className).toContain('bg-surface-backdrop')
  })

  // The resize option asks the server for 64 pixels. Drawing that file at 128 stretched it and made the
  // example look soft, which shows the opposite of what the option is for.
  it('draws the resized logo at the 64 pixels it asks for, and the other options at 128', () => {
    render(<ImageOptionsExample />)
    const resized = within(panel()).getAllByRole('img')[0]
    expect(resized.getAttribute('width')).toBe('64')
    select('Vector only')
    expect(within(panel()).getAllByRole('img')[0].getAttribute('width')).toBe('128')
  })

  it('keeps the other options on the inset surface, not the dark backdrop', () => {
    render(<ImageOptionsExample />)
    const well = within(panel()).getAllByRole('img')[0].closest('.rounded-lg')!
    expect(well.className).toContain('bg-surface-inset')
  })

  it('reserves the preview height, so the text below does not move when the selection changes', () => {
    render(<ImageOptionsExample />)
    const preview = within(panel()).getByText('Resize and convert', { selector: 'p' }).parentElement!
    expect(preview.className).toContain('min-h-[15rem]')
    select('Plate for a dark page')
    expect(within(panel()).getByText('Plate for a dark page', { selector: 'p' }).parentElement!.className).toContain(
      'min-h-[15rem]',
    )
  })
})

describe('ImageOptionsExample, the description and copy', () => {
  it('shows the description of the selected option beside its preview', () => {
    render(<ImageOptionsExample />)
    select('Custom plate')
    expect(within(panel()).getByText(IMAGE_OPTION_TILES[3].description)).toBeTruthy()
  })

  it('copies the exact address of the selected option, and says so', async () => {
    const writeText = stubClipboard()
    render(<ImageOptionsExample />)
    select('Vector only')

    fireEvent.click(within(panel()).getByRole('button', { name: /Copy address/ }))

    expect(writeText).toHaveBeenCalledWith(
      getApiUrl('/image/eip155-1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599?only=vector'),
    )
    expect(await screen.findByRole('button', { name: /Copied!/ })).toBeTruthy()
  })

  it('gives each address of the dark-page option its own copy button', () => {
    stubClipboard()
    render(<ImageOptionsExample />)
    select('Plate for a dark page')
    expect(within(panel()).getAllByRole('button', { name: /Copy address/ })).toHaveLength(2)
  })
})

describe('ImageOptionsExample, the keyboard', () => {
  it('moves to the next option with the right arrow key, and selects it', async () => {
    const user = userEvent.setup()
    render(<ImageOptionsExample />)
    tabs()[0].focus()

    await user.keyboard('{ArrowRight}')

    expect(tabs()[1].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs()[1])
  })

  it('moves to the previous option with the left arrow key, wrapping from the first to the last', async () => {
    const user = userEvent.setup()
    render(<ImageOptionsExample />)
    tabs()[0].focus()

    await user.keyboard('{ArrowLeft}')

    expect(tabs()[3].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs()[3])
  })

  it('goes to the first and the last option with Home and End', async () => {
    const user = userEvent.setup()
    render(<ImageOptionsExample />)
    tabs()[0].focus()

    await user.keyboard('{End}')
    expect(tabs()[3].getAttribute('aria-selected')).toBe('true')

    await user.keyboard('{Home}')
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true')
  })

  it('leaves the selection alone for a key the tabs do not use', async () => {
    const user = userEvent.setup()
    render(<ImageOptionsExample />)
    tabs()[0].focus()

    await user.keyboard('a')

    expect(tabs()[0].getAttribute('aria-selected')).toBe('true')
  })

  it('selects an option with Enter when its tab has focus', async () => {
    const user = userEvent.setup()
    render(<ImageOptionsExample />)
    await act(async () => {
      tabs()[2].focus()
    })

    await user.keyboard('{Enter}')

    expect(tabs()[2].getAttribute('aria-selected')).toBe('true')
  })
})

describe('ImageOptionsExample, motion', () => {
  it('turns off the colour transition of the tabs when the reader asks for reduced motion', () => {
    render(<ImageOptionsExample />)
    expect(tabs()[0].className).toContain('motion-reduce:transition-none')
  })
})

/** The tab with this title. */
function tab(title: string) {
  return screen.getByRole('tab', { name: title })
}
