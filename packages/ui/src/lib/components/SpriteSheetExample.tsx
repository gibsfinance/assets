import { getApiUrl } from '../utils'
import {
  SPRITE_PREVIEW_TOKEN_KEYS,
  SPRITE_SCOPE_CLASS,
  SPRITE_SHEET_PATH,
  SPRITE_STYLESHEET_PATH,
  spritePreviewClass,
  spriteSnippet,
} from '../utils/integration-examples'
import CodeBlock from './CodeBlock'
import { IntegrationAddress } from './IntegrationCard'

/**
 * The sprite sheet example on the home page: twenty logos drawn the way a site draws them, from the
 * real stylesheet, plus the snippet that does it and the address of the sheet itself.
 *
 * The stylesheet is linked in place. Each logo is one `<span>` with the list's scope class, which
 * sets the size and the sheet, and its own token class, which sets where on the sheet the logo is.
 * The classes come from the layout module the server uses (see `integration-examples`), and a test
 * recomputes them through it.
 */
export default function SpriteSheetExample() {
  const stylesheetHref = getApiUrl(SPRITE_STYLESHEET_PATH)
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-none flex-col gap-3 lg:max-w-[38rem]">
        <div className="rounded-lg bg-surface-inset p-4">
          <link rel="stylesheet" href={stylesheetHref} />
          <div
            role="img"
            aria-label="Twenty token logos, each drawn from the sprite sheet"
            className="flex flex-wrap gap-1">
            {SPRITE_PREVIEW_TOKEN_KEYS.map((key) => (
              <span key={key} className={`${SPRITE_SCOPE_CLASS} ${spritePreviewClass(key)}`} />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-content-subtle">The sheet itself, which the stylesheet points at:</p>
          <IntegrationAddress href={getApiUrl(SPRITE_SHEET_PATH)} />
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <p className="text-sm text-content-subtle">
          The example draws 48-pixel cells with a 4-pixel gap, at scale 2 so the logos stay sharp on high-density
          screens. Add chainId to keep one chain, content=mixed for vector logos as data addresses, gap for space
          between cells, bg or contrast for a plate behind each logo, and scale=2 for sharp sheets. Sizes run from 16 to
          128 pixels for size, 5 to 50 for cols, and 1 to 2000 tokens for limit.
        </p>
        <CodeBlock
          code={spriteSnippet({ stylesheetUrl: stylesheetHref })}
          lang="html"
          preClasses="[&>pre]:whitespace-pre-wrap [&>pre]:break-all"
        />
      </div>
    </div>
  )
}
