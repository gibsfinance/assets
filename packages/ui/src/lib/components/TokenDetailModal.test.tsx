/**
 * The panel that opens when a token in the browser is clicked.
 *
 * Everything it shows is derived from the one token it was handed, so the failures it
 * has to be held to are all about that token going missing or being replaced:
 *
 *  - Opening with nothing. `open` is driven by the token being non-null, and the body is
 *    guarded separately. If the two ever disagree, the dialog appears as an empty sheet
 *    over the page with no way to tell what it was supposed to be about.
 *  - Addressing the wrong chain. The image path is built from the namespace the token
 *    was listed under, not from its bare chain number, because eleven bare numbers are
 *    claimed by two namespaces. Deriving from the number asks for a Solana token under
 *    an Ethereum-Virtual-Machine path, which the server rejects as a malformed address.
 *  - Handing the studio a different token than the one on screen. That failure surfaces
 *    a whole screen later, in a configurator showing an icon nobody asked for.
 *
 * Image metadata is fetched over HTTP HEAD and, for raster formats, by decoding the
 * image. jsdom loads no images, so the DOM Image constructor is stubbed at the host
 * boundary alongside fetch and the clipboard. No application source is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TokenDetailModal from './TokenDetailModal'
import { StudioProvider, useStudio } from '../contexts/StudioContext'
import { getApiUrl } from '../utils'
import type { Token } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAI: Token = {
  chainId: 1,
  address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  name: 'Dai Stablecoin',
  symbol: 'DAI',
  decimals: 18,
  hasIcon: true,
  sourceList: 'uniswap/default',
}

/**
 * Bare reference 501 belongs to Solana here and to Columbus testnet under
 * eip155. Only `chainIdentifier` says which.
 */
const SOLANA_TOKEN: Token = {
  chainId: 501,
  chainIdentifier: 'solana-501',
  address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  hasIcon: true,
  sourceList: 'solana/coins',
}

// ---------------------------------------------------------------------------
// Host stubs
// ---------------------------------------------------------------------------

type HeadResponse = { contentType: string | null; contentLength: string | null }

/** Answers the HEAD request the metadata fetch makes. */
function stubHead(response: HeadResponse | 'reject') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (response === 'reject') throw new Error('network down')
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'content-type' ? response.contentType : response.contentLength,
        },
      }
    }),
  )
}

/**
 * Stands in for the DOM Image constructor the metadata fetch decodes with. jsdom never
 * loads image bytes, so without this the decode promise never settles and the panel
 * stays in its loading state forever.
 */
function stubImageDecode(result: { width: number; height: number } | 'error') {
  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    crossOrigin: string | null = null
    naturalWidth = result === 'error' ? 0 : result.width
    naturalHeight = result === 'error' ? 0 : result.height
    set src(_value: string) {
      queueMicrotask(() => (result === 'error' ? this.onerror?.() : this.onload?.()))
    }
  }
  vi.stubGlobal('Image', FakeImage)
}

const clipboardWrites: string[] = []

function stubClipboard() {
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: {
      writeText: async (text: string) => {
        clipboardWrites.push(text)
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** Publishes the studio state so a test can see what the modal handed it. */
let studioSnapshot: { selectedToken: Token | null; selectedChainId: string | null; activeTab: string } | null = null

function StudioProbe() {
  const studio = useStudio()
  studioSnapshot = {
    selectedToken: studio.selectedToken,
    selectedChainId: studio.selectedChainId,
    activeTab: studio.activeTab,
  }
  return null
}

function renderModal(token: Token | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const onClose = vi.fn()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <StudioProvider>
        <StudioProbe />
        <TokenDetailModal token={token} onClose={onClose} />
      </StudioProvider>
    </QueryClientProvider>,
  )
  return { ...view, onClose }
}

const imagePathFor = (token: Token) =>
  `/image/${token.chainIdentifier ?? `eip155-${token.chainId}`}/${token.address}`

beforeEach(() => {
  localStorage.clear()
  clipboardWrites.length = 0
  studioSnapshot = null
  stubHead({ contentType: 'image/svg+xml', contentLength: '2048' })
  stubImageDecode({ width: 64, height: 64 })
  stubClipboard()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  localStorage.clear()
})

// ---------------------------------------------------------------------------

describe('TokenDetailModal — what it opens with', () => {
  it('stays shut when there is no token to describe', () => {
    // The dialog is open exactly when a token is present. If those two ever come apart,
    // the user gets a blank sheet over the page and no way to know what it was for.
    renderModal(null)
    expect(screen.queryByLabelText('Close')).toBeNull()
    expect(screen.queryByText('Image Metadata')).toBeNull()
  })

  it('opens with the token it was asked about', async () => {
    renderModal(DAI)
    expect(await screen.findByText('Dai Stablecoin')).toBeTruthy()
    expect(screen.getByLabelText('Close')).toBeTruthy()
  })

  it('names the network rather than repeating its number', async () => {
    // "Chain 369" beside a token nobody recognises is indistinguishable from a lookup
    // that failed; the curated name is what tells the user they are on PulseChain.
    renderModal({ ...DAI, chainId: 369 })
    await screen.findByText('Dai Stablecoin')
    expect(screen.getByText(/PulseChain/).textContent).toContain('DAI')
  })

  it('credits the list the token was found in', async () => {
    renderModal(DAI)
    expect(await screen.findByText('uniswap/default')).toBeTruthy()
  })
})

describe('TokenDetailModal — addressing the image', () => {
  it('builds the image path from the namespace the token was listed under', async () => {
    // Deriving from the bare chain number would ask for a base58 Solana address under
    // an Ethereum-Virtual-Machine path, which the server rejects outright.
    renderModal(SOLANA_TOKEN)
    await screen.findByText('USD Coin')
    const source = document.querySelector('img')!.getAttribute('src')!
    expect(source).toContain(`/image/solana-501/${SOLANA_TOKEN.address}`)
    expect(source).not.toContain('eip155-501')
  })

  it('prefixes a bare Ethereum-Virtual-Machine chain rather than passing the number through', async () => {
    renderModal(DAI)
    await screen.findByText('Dai Stablecoin')
    expect(document.querySelector('img')!.getAttribute('src')).toContain(
      `/image/eip155-1/${DAI.address}`,
    )
  })

  it('shows the caller the same endpoint it is rendering from', async () => {
    // The panel doubles as documentation: the path it prints is the one a developer will
    // paste into their own page, so it has to be the path actually being served.
    renderModal(SOLANA_TOKEN)
    await screen.findByText('USD Coin')
    expect(screen.getByText(imagePathFor(SOLANA_TOKEN))).toBeTruthy()
  })
})

describe('TokenDetailModal — image metadata', () => {
  it('says it is still working before the metadata arrives', async () => {
    renderModal(DAI)
    expect(screen.getByText(/Loading metadata/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText(/Loading metadata/)).toBeNull())
  })

  it('reports a vector icon as resolution independent rather than as pixels', async () => {
    // Scalable is the outcome the studio steers users toward, and a vector genuinely has
    // no pixel dimensions — printing any would be an invention.
    renderModal(DAI)
    expect(await screen.findByText('SVG')).toBeTruthy()
    expect(screen.getByText('Scalable')).toBeTruthy()
    expect(screen.getByText('Resolution Independent')).toBeTruthy()
  })

  it('reports a raster icon with the dimensions it decoded to', async () => {
    stubHead({ contentType: 'image/png', contentLength: '4096' })
    stubImageDecode({ width: 256, height: 128 })
    renderModal(DAI)
    expect(await screen.findByText('PNG')).toBeTruthy()
    expect(screen.getByText('256 × 128 px')).toBeTruthy()
    expect(screen.queryByText('Resolution Independent')).toBeNull()
  })

  it('admits to unknown dimensions when the image would not decode', async () => {
    stubHead({ contentType: 'image/webp', contentLength: '900' })
    stubImageDecode('error')
    renderModal(DAI)
    expect(await screen.findByText('WEBP')).toBeTruthy()
    expect(screen.getByText('Unknown')).toBeTruthy()
  })

  it('scales the file size to the unit a human reads', async () => {
    stubHead({ contentType: 'image/svg+xml', contentLength: '2048' })
    renderModal(DAI)
    expect(await screen.findByText('2.0 KB')).toBeTruthy()

    cleanup()
    stubHead({ contentType: 'image/svg+xml', contentLength: '900' })
    renderModal(DAI)
    expect(await screen.findByText('900 B')).toBeTruthy()

    cleanup()
    stubHead({ contentType: 'image/svg+xml', contentLength: String(3 * 1024 * 1024) })
    renderModal(DAI)
    expect(await screen.findByText('3.0 MB')).toBeTruthy()
  })

  it('admits to an unknown size when the server sent no length', async () => {
    stubHead({ contentType: 'image/svg+xml', contentLength: null })
    renderModal(DAI)
    await screen.findByText('SVG')
    expect(screen.getByText('Unknown')).toBeTruthy()
  })

  it('still describes the token when the metadata request fails outright', async () => {
    // A failed HEAD must not take the panel down with it — the address, the endpoint and
    // the studio hand-off are all still useful without it.
    stubHead('reject')
    stubImageDecode('error')
    renderModal(DAI)
    await waitFor(() => expect(screen.queryByText(/Loading metadata/)).toBeNull())
    expect(screen.getByText('Dai Stablecoin')).toBeTruthy()
    expect(screen.getByText('unknown')).toBeTruthy()
  })
})

describe('TokenDetailModal — the actions it offers', () => {
  it('hands the studio the token that is on screen, then gets out of the way', async () => {
    // Sending the wrong token surfaces a whole screen later, as a configurator showing
    // an icon nobody asked for. The chain has to travel as its namespaced identifier for
    // the same reason the image path does.
    const { onClose } = renderModal(SOLANA_TOKEN)
    await screen.findByText('USD Coin')

    fireEvent.click(screen.getByText('Configure in Studio'))

    expect(studioSnapshot!.selectedToken).toEqual(SOLANA_TOKEN)
    expect(studioSnapshot!.selectedChainId).toBe('solana-501')
    expect(studioSnapshot!.activeTab).toBe('configure')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the close control is used', async () => {
    const { onClose } = renderModal(DAI)
    await screen.findByText('Dai Stablecoin')
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('copies the absolute image URL, not the path it displays', async () => {
    // The displayed path is relative so it reads as documentation; what gets pasted has
    // to be something a browser can actually open.
    renderModal(DAI)
    await screen.findByText('Dai Stablecoin')

    fireEvent.click(screen.getByTitle('Copy image URL'))
    await waitFor(() => expect(clipboardWrites).toHaveLength(1))
    expect(clipboardWrites[0]).toBe(getApiUrl(imagePathFor(DAI)))
  })

  it('confirms a copy and then quietly reverts', async () => {
    // Without the revert the button stays reading "Copied!" over a clipboard that has
    // long since moved on, so a second copy gives no feedback at all.
    renderModal(DAI)
    const button = await screen.findByTitle('Copy to clipboard')

    // Fake timers only once the panel has settled: the queries above resolve through
    // real timers, and faking them earlier would stall the render this test needs.
    vi.useFakeTimers()
    fireEvent.click(button)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTitle('Copied!')).toBeTruthy()
    expect(clipboardWrites[0]).toBe(getApiUrl(imagePathFor(DAI)))

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByTitle('Copy to clipboard')).toBeTruthy()
  })
})
