import { useEffect, useRef, useMemo } from 'react'
import { getApiUrl } from '../utils'

const SIZES = [28, 32, 36]
const DURATIONS = [35, 45, 30]
const DIRECTIONS: Array<'normal' | 'reverse'> = ['normal', 'reverse', 'normal']
const ICONS_PER_ROW = 40

let keyframesInjected = false
function ensureKeyframes() {
  if (keyframesInjected) return
  keyframesInjected = true
  const style = document.createElement('style')
  style.textContent = '@keyframes conveyor{from{transform:translateX(0)}to{transform:translateX(-50%)}}'
  document.head.appendChild(style)
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Curated list of known-good token + network icon paths */
const ICON_PATHS = [
  // Network icons
  '/image/1', '/image/369', '/image/56', '/image/137', '/image/42161',
  '/image/10', '/image/8453', '/image/100', '/image/43114', '/image/250',
  '/image/324', '/image/1284', '/image/288', '/image/5000', '/image/146',
  // Ethereum blue chips
  '/image/1/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
  '/image/1/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  '/image/1/0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
  '/image/1/0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
  '/image/1/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
  '/image/1/0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
  '/image/1/0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
  '/image/1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  '/image/1/0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', // SHIB
  '/image/1/0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', // MATIC
  '/image/1/0x6982508145454Ce325dDbE47a25d4ec3d2311933', // PEPE
  '/image/1/0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', // LDO
  '/image/1/0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', // stETH
  '/image/1/0x853d955aCEf822Db058eb8505911ED77F175b99e', // FRAX
  '/image/1/0x4d224452801ACEd8B2F0aebE155379bb5D594381', // APE
  // PulseChain tokens
  '/image/369/0xa1077a294dde1b09bb078844df40758a5d0f9a27', // WPLS
  '/image/369/0xca35638a3fddd02fec597d8c1681198c06b23f58',
  '/image/369/0xbbcf895bfcb57d0f457d050bb806d1499436c0ce',
  '/image/369/0x0567ca0de35606e9c260cc2358404b11de21db44',
  '/image/369/0xaec4c07537b03e3e62fc066ec62401aed5fdd361',
  '/image/369/0xdfdc2836fd2e63bba9f0ee07901ad465bff4de71',
  '/image/369/0xcfcffe432a48db53f59c301422d2edd77b2a88d7',
  '/image/369/0x9159f1d2a9f51998fc9ab03fbd8f265ab14a1b3b',
  '/image/369/0x0deed1486bc52aa0d3e6f8849cec5add6598a162',
  '/image/369/0x600136da8cc6d1ea07449514604dc4ab7098db82',
  '/image/369/0x8854bc985fb5725f872c8856bea11b917caeb2fe',
  '/image/369/0x96e035ae0905efac8f733f133462f971cfa45db1',
  '/image/369/0x9663c2d75ffd5f4017310405fce61720af45b829',
  '/image/369/0xa12e2661ec6603cbbb891072b2ad5b3d5edb48bd',
  '/image/369/0xecd465a15fac825b0fe69416a4c7bfe03a50c12e',
  '/image/369/0xa9d4230b4899e6aac0d84e540941b3832aba3ba0',
  '/image/369/0xf876bdf9d6403aa7d5bf7f523e8f440a841cc596',
  '/image/369/0x73d8a4d01d658e565cf83068397fd39baf386c48',
  '/image/369/0x7663e79e09d78142e3f6e4dca19faf604159842d',
  '/image/369/0x1dcbf345bc44696bbbed402367f7c62e524fe8b5',
]

// Fixed height: sum of row sizes + gaps
const TOTAL_HEIGHT = SIZES.reduce((a, b) => a + b, 0) + (SIZES.length - 1) * 4

export default function FloatingIcons({ className }: { className?: string }) {
  const row0 = useRef<HTMLDivElement>(null)
  const row1 = useRef<HTMLDivElement>(null)
  const row2 = useRef<HTMLDivElement>(null)
  const rowRefs = [row0, row1, row2]

  // Build full URLs and shuffle once on mount
  const allSources = useMemo(() => shuffle(ICON_PATHS.map((p) => getApiUrl(p))), [])

  // Build row icon arrays — stable, never changes
  const rowIcons = useMemo(() =>
    [0, 1, 2].map((rowIdx) => {
      const perRow = ICONS_PER_ROW * 2
      const icons: string[] = []
      for (let i = 0; i < perRow; i++) {
        icons.push(allSources[(rowIdx * perRow + i) % allSources.length])
      }
      return icons
    }),
  [allSources])

  // Apply animation once after mount
  useEffect(() => {
    ensureKeyframes()
    requestAnimationFrame(() => {
      for (let i = 0; i < rowRefs.length; i++) {
        const el = rowRefs[i].current
        if (!el) continue
        el.style.setProperty('animation', `conveyor ${DURATIONS[i]}s linear infinite ${DIRECTIONS[i]}`, 'important')
      }
    })
  }, [])

  return (
    <div className={`overflow-hidden space-y-1 ${className ?? ''}`} style={{ height: TOTAL_HEIGHT }} aria-hidden="true">
      {rowIcons.map((icons, rowIdx) => (
        <div key={rowIdx} className="overflow-hidden">
          <div
            ref={rowRefs[rowIdx]}
            className="flex gap-3 items-center"
            style={{ width: 'max-content' }}
          >
            {icons.map((src, i) => (
              <a
                key={`${rowIdx}-${i}`}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 pointer-events-auto"
              >
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  className="rounded-full"
                  style={{ width: SIZES[rowIdx], height: SIZES[rowIdx] }}
                />
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
