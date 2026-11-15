import { useId, useState, type KeyboardEvent } from 'react'
import {
  IMAGE_OPTION_TILES,
  type ImageOptionSample,
  type ImageOptionSurface,
  type ImageOptionTile,
} from '../utils/integration-examples'
import { getApiUrl } from '../utils'
import { nextTabIndex } from '../utils/tab-keys'
import Image from './Image'
import CopyButton from './CopyButton'
import { IntegrationAddress } from './IntegrationCard'

/** The logo well's background, by the surface a tile names. A dark logo needs the dark well. */
const WELL_SURFACE_CLASS: Record<ImageOptionSurface, string> = {
  inset: 'bg-surface-inset',
  backdrop: 'bg-surface-backdrop',
}

const TAB_BASE =
  'rounded-lg border px-3 py-2 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
const TAB_SELECTED = 'border-accent/40 bg-surface-raised text-content-strong'
const TAB_IDLE = 'border-border bg-surface-inset text-content-muted hover:text-content-body'

/**
 * The reserved height of the preview. Every option fits in it, so changing the selection never moves
 * the text below. Sized for the tallest option, the dark-page pair with its captions.
 */
const PREVIEW_HEIGHT_CLASS = 'min-h-[15rem] md:min-h-[16rem]'

/**
 * The selected option's logos, drawn at the exact address each one names. The caption under each
 * logo says what the logo shows, and the option's title sits above them.
 */
function ImageOptionPreview({ tile }: { tile: ImageOptionTile }) {
  const columnsClass = tile.samples.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
  return (
    <div
      className={`flex w-full flex-none flex-col items-center justify-center gap-3 rounded-lg bg-surface-inset p-4 md:w-80 ${PREVIEW_HEIGHT_CLASS}`}>
      <p aria-live="polite" className="text-sm font-bold text-content-strong">
        {tile.title}
      </p>
      <div className={`grid justify-items-center gap-4 ${columnsClass}`}>
        {tile.samples.map((sample) => (
          <figure key={sample.path} className="flex flex-col items-center gap-2">
            <div className={`flex rounded-lg p-3 ${WELL_SURFACE_CLASS[tile.surface]}`}>
              <Image src={getApiUrl(sample.path)} alt={sample.alt} size={128} fullResolution shape="rect" />
            </div>
            {sample.caption && <figcaption className="text-xs text-content-subtle">{sample.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </div>
  )
}

/** One selected sample's address, with the button that copies that exact address. */
function SampleAddress({ sample }: { sample: ImageOptionSample }) {
  const href = getApiUrl(sample.path)
  return (
    <div className="flex flex-col items-start gap-2">
      <IntegrationAddress href={href} />
      <CopyButton text={href} label="Copy address" variant="secondary" />
    </div>
  )
}

/**
 * The image options example on the home page: a row of tabs, one per option, and the selected option's
 * preview, its description, and its addresses with copy buttons.
 *
 * The tabs follow the WAI-ARIA tabs pattern. Only the selected tab takes the Tab key, and the arrow,
 * Home and End keys move between tabs and select the one they reach. The first option is selected on
 * load. Changing the selection does not move the page, because the preview has a reserved height.
 */
export default function ImageOptionsExample() {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const baseId = useId()
  const selectedTile = IMAGE_OPTION_TILES[selectedIndex]
  const tabId = (index: number) => `${baseId}-tab-${index}`
  const panelId = `${baseId}-panel`

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextIndex = nextTabIndex({ current: selectedIndex, key: event.key, count: IMAGE_OPTION_TILES.length })
    if (nextIndex === null) return
    event.preventDefault()
    setSelectedIndex(nextIndex)
    // Every tab is rendered, so the element for the index exists; focus follows the selection.
    const nextTab = document.getElementById(tabId(nextIndex)) as HTMLButtonElement
    nextTab.focus()
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Image options" className="flex flex-wrap gap-2" onKeyDown={handleTabKeyDown}>
        {IMAGE_OPTION_TILES.map((tile, index) => {
          const selected = index === selectedIndex
          return (
            <button
              key={tile.key}
              id={tabId(index)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => setSelectedIndex(index)}
              className={`${TAB_BASE} ${selected ? TAB_SELECTED : TAB_IDLE}`}>
              {tile.title}
            </button>
          )
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(selectedIndex)}
        className="flex flex-col gap-5 md:flex-row md:items-start">
        <ImageOptionPreview tile={selectedTile} />
        <div className="min-w-0 flex-1 space-y-4">
          <p className="text-content-secondary">{selectedTile.description}</p>
          {selectedTile.samples.map((sample) => (
            <SampleAddress key={sample.path} sample={sample} />
          ))}
        </div>
      </div>
    </div>
  )
}
