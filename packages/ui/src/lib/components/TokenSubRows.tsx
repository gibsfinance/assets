import Image from './Image'
import type { TokenListReference } from '../types'

interface TokenSubRowsProps {
  references: TokenListReference[]
  onNavigateToList?: (sourceList: string) => void
}

export default function TokenSubRows({ references, onNavigateToList }: TokenSubRowsProps) {
  if (references.length <= 1) return null

  return (
    <div className="ml-12 border-l border-gray-200 pl-3 dark:border-surface-3">
      {references.map((ref, idx) => {
        const isLast = idx === references.length - 1
        return (
          <div key={ref.sourceList} className="flex items-center gap-2 py-1 text-xs">
            <span className="text-gray-300 dark:text-surface-3">{isLast ? '└─' : '├─'}</span>
            <Image src={ref.imageUri} size={16} skeleton lazy shape="circle" className="rounded-full" />
            <span className="flex-1 truncate text-gray-500 dark:text-white/40">{ref.sourceList}</span>
            <a
              href={ref.imageUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-accent-500 dark:text-white/30"
              title="Open image"
              onClick={(e) => e.stopPropagation()}
            >
              <i className="fas fa-external-link-alt text-[10px]" />
            </a>
            {onNavigateToList && (
              <button
                type="button"
                className="text-gray-400 hover:text-accent-500 dark:text-white/30"
                title="Open in list editor"
                onClick={(e) => { e.stopPropagation(); onNavigateToList(ref.sourceList) }}
              >
                <i className="fas fa-arrow-right text-[10px]" />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
