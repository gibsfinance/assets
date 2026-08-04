/**
 * One draggable token inside the list editor.
 *
 * The row is where a token being edited is identified, so every identifying detail it
 * shows has to come from that token and no other: its own icon, its own truncated
 * address, its own chain. The failure worth guarding is quiet — a row showing a
 * neighbour's icon, or an icon fetched for the wrong chain, still renders a perfectly
 * good picture. Nothing errors; the list simply describes tokens that are not there.
 *
 * The row also carries three callbacks that mutate the list, and each one has to carry
 * the row's own token back out. A remove that reports the wrong address deletes the
 * wrong row, and an upload that reports the wrong token overwrites the wrong icon.
 *
 * The icon has two mutually exclusive shapes: an existing image is a click-to-edit
 * button, an absent one is an inline upload target. Which of the two appears decides
 * whether the user can add an icon at all.
 *
 * Rows are sortable, so they are mounted inside the same drag-and-drop and sortable
 * contexts the editor provides. IntersectionObserver is stubbed at the host boundary
 * because the icon is lazy and jsdom supplies none. No application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import ListTokenRow from './ListTokenRow'
import type { LocalToken } from '../hooks/useLocalLists'

const DAI: LocalToken = {
  chainId: 1,
  address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  name: 'Dai Stablecoin',
  symbol: 'DAI',
  decimals: 18,
  imageUri: 'https://icons.test/dai.svg',
  order: 0,
}

/** Reports every observed element as on screen so the lazy icon resolves to a real image. */
function stubIntersectionObserver() {
  class ImmediateObserver {
    constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() {
      this.cb([{ isIntersecting: true }])
    }
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', ImmediateObserver)
}

beforeEach(stubIntersectionObserver)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const makeHandlers = () => ({
  onRemove: vi.fn<(address: string) => void>(),
  onImageClick: vi.fn<(token: LocalToken) => void>(),
  onImageUpload: vi.fn<(token: LocalToken, dataUri: string) => void>(),
})

function renderRow(tokens: LocalToken[] = [DAI]) {
  const handlers = makeHandlers()
  const view = render(
    <DndContext>
      <SortableContext
        items={tokens.map((token) => `${token.chainId}-${token.address}`)}
        strategy={verticalListSortingStrategy}
      >
        {tokens.map((token) => (
          <ListTokenRow key={`${token.chainId}-${token.address}`} token={token} {...handlers} />
        ))}
      </SortableContext>
    </DndContext>,
  )
  return { ...view, ...handlers }
}

describe('ListTokenRow — what the row says about its token', () => {
  it('shows the token name and symbol', () => {
    renderRow()
    expect(screen.getByText('Dai Stablecoin')).toBeTruthy()
    expect(screen.getByText('DAI')).toBeTruthy()
  })

  it('falls back to readable placeholders when a token has no name or symbol', () => {
    // A token pasted in by address alone has neither yet. Blank cells would leave the
    // row looking like a rendering failure rather than an incomplete entry.
    renderRow([{ ...DAI, name: '', symbol: '' }])
    expect(screen.getByText('Unknown')).toBeTruthy()
    expect(screen.getByText('???')).toBeTruthy()
  })

  it('truncates the address from both ends so the checksum tail stays visible', () => {
    // The last characters are what a user compares against a block explorer. Truncating
    // from the right alone would leave two different addresses looking identical.
    const { container } = renderRow()
    const shown = container.querySelector('.font-mono')!.textContent!
    expect(shown.startsWith(DAI.address.slice(0, 10))).toBe(true)
    expect(shown.endsWith(DAI.address.slice(-6))).toBe(true)
    expect(shown).not.toContain(DAI.address)
  })

  it('states the chain and decimals the token was entered under', () => {
    // Two rows for the same address on different chains are otherwise identical, and
    // decimals silently decide whether a balance reads as 1 or 1000000000000000000.
    const { container } = renderRow([{ ...DAI, chainId: 369, decimals: 6 }])
    expect(container.textContent).toContain('chain 369')
    expect(container.textContent).toContain('6d')
  })

  it('gives each row the icon belonging to its own token', () => {
    // The silent failure: the second row drawn with the first row's icon. Both load,
    // both look right, and the list describes tokens it is not holding.
    const other: LocalToken = {
      ...DAI,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      name: 'USD Coin',
      symbol: 'USDC',
      imageUri: 'https://icons.test/usdc.png',
    }
    renderRow([DAI, other])
    const sources = Array.from(document.querySelectorAll('img')).map((image) => image.getAttribute('src'))
    expect(sources).toEqual([DAI.imageUri, other.imageUri])
  })

  it('uses the stored image exactly as given rather than re-deriving a URL', () => {
    // The stored value can be a data URI the user just uploaded, or an image on a chain
    // this row could not address by number. Rebuilding it from chain and address would
    // throw either away.
    renderRow([{ ...DAI, chainId: 501, imageUri: 'data:image/png;base64,AAAA' }])
    expect(document.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA')
  })
})

describe('ListTokenRow — the icon control', () => {
  it('offers click-to-edit when the token already has an image', () => {
    renderRow()
    expect(screen.getByTitle('Edit image')).toBeTruthy()
    expect(screen.queryByLabelText('Upload token image')).toBeNull()
  })

  it('offers an inline upload target when the token has no image', () => {
    // Without this branch a token added by address has no route to an icon at all.
    renderRow([{ ...DAI, imageUri: undefined }])
    expect(screen.getByLabelText('Upload token image')).toBeTruthy()
    expect(screen.queryByTitle('Edit image')).toBeNull()
  })

  it('reports which token was clicked for editing', () => {
    const other = { ...DAI, address: '0x0000000000000000000000000000000000000042', name: 'USD Coin' }
    const { onImageClick } = renderRow([DAI, other])
    fireEvent.click(screen.getAllByTitle('Edit image')[1])
    expect(onImageClick).toHaveBeenCalledWith(other)
  })

  it('keeps the icon click from reaching whatever wraps the row', () => {
    // The editor puts rows inside surfaces that respond to clicks of their own; opening
    // the image editor must not also trigger those.
    const onSurfaceClick = vi.fn()
    render(
      <div onClick={onSurfaceClick}>
        <DndContext>
          <SortableContext items={[`${DAI.chainId}-${DAI.address}`]} strategy={verticalListSortingStrategy}>
            <ListTokenRow token={DAI} {...makeHandlers()} />
          </SortableContext>
        </DndContext>
      </div>,
    )
    fireEvent.click(screen.getByTitle('Edit image'))
    expect(onSurfaceClick).not.toHaveBeenCalled()
  })

  it('hands an uploaded image back together with the token it belongs to', async () => {
    // The upload widget only knows the bytes. If the row loses track of which token it
    // is attached to, the icon lands on a different entry in the list.
    const withoutImage = { ...DAI, imageUri: undefined }
    const { onImageUpload } = renderRow([withoutImage])

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['<svg />'], 'dai.svg', { type: 'image/svg+xml' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(onImageUpload).toHaveBeenCalled())
    const [token, dataUri] = onImageUpload.mock.calls[0]
    expect(token).toEqual(withoutImage)
    expect(String(dataUri).startsWith('data:')).toBe(true)
  })
})

describe('ListTokenRow — removal', () => {
  it('removes by the address of the row that was clicked', () => {
    // Removal is keyed on address alone, so the wrong argument silently deletes a
    // different token than the one whose bin the user clicked.
    const other = { ...DAI, address: '0x0000000000000000000000000000000000000042', name: 'USD Coin' }
    const { onRemove } = renderRow([DAI, other])
    fireEvent.click(screen.getAllByTitle('Remove token')[1])
    expect(onRemove).toHaveBeenCalledWith(other.address)
  })

  it('does not remove anything until the control is used', () => {
    const { onRemove } = renderRow()
    expect(onRemove).not.toHaveBeenCalled()
  })
})
