import Image from './Image'
import type { TokenListReference } from '../types'
import { faArrowRight, faUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import { Icon } from './Icon'

interface TokenSubRowsProps {
  references: TokenListReference[]
  onNavigateToList?: (sourceList: string) => void
}

export default function TokenSubRows({ references, onNavigateToList }: TokenSubRowsProps) {
  if (references.length <= 1) return null

  return (
    <div className="relative pb-1 pl-[30px] pr-3">
      {/* Vertical line — stops at center of last row */}
      <div className="absolute left-[30px] top-0 w-px bg-surface-active" style={{ bottom: `${22 / 2}px` }} />

      {references.map((ref, idx) => {
        const isLast = idx === references.length - 1
        return (
          <div key={ref.sourceList} className="relative flex items-center gap-1.5 py-1">
            {/* Horizontal branch */}
            <div className="absolute left-0 top-1/2 h-px w-3 bg-surface-active" />
            {/* Last row: vertical stub from top to center */}
            {isLast && <div className="absolute left-0 top-0 h-1/2 w-px bg-surface-active" />}
            <div className="w-3 flex-shrink-0" />
            <Image src={ref.imageUri} size={14} skeleton lazy shape="circle" className="rounded-full" />
            <span className="flex-1 truncate text-[10px] text-content-subtle">{ref.sourceList}</span>
            {ref.imageFormat && (
              <span
                className={`rounded px-1 py-px text-[8px] ${
                  ref.imageFormat === 'svg' ? 'bg-accent/10 text-accent-content' : 'bg-surface-wash text-content-faint'
                }`}>
                {ref.imageFormat}
              </span>
            )}
            <a
              href={ref.imageUri}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded p-1 text-[10px] text-content-faint transition-colors hover:bg-surface-wash hover:text-accent-content"
              title="Open image"
              onClick={(e) => e.stopPropagation()}>
              <Icon icon={faUpRightFromSquare} />
            </a>
            {onNavigateToList && (
              <button
                type="button"
                className="rounded p-1 text-[10px] text-content-faint transition-colors hover:bg-surface-wash hover:text-accent-content"
                title="Open in list editor"
                onClick={(e) => {
                  e.stopPropagation()
                  onNavigateToList(ref.sourceList)
                }}>
                <Icon icon={faArrowRight} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
