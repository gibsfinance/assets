import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import CodeBlock from './CodeBlock'
import Image from './Image'

interface EndpointCardProps {
  method: string
  path: string
  description: string
  example?: string
}

/**
 * Splits an endpoint path into segments, highlighting `{param}` style
 * parameter tokens with accent color.
 */
function PathDisplay({ path }: { path: string }) {
  // Split on `{...}` tokens
  const parts = path.split(/(\{[^}]+\})/)

  return (
    <span className="font-mono text-sm">
      {parts.map((part, index) => {
        const isParam = /^\{[^}]+\}$/.test(part)
        return isParam ? (
          <span key={index} className="text-accent-500">
            {part}
          </span>
        ) : (
          <span key={index} className="text-gray-900 dark:text-white">
            {part}
          </span>
        )
      })}
    </span>
  )
}

export default function EndpointCard({ method, path, description, example }: EndpointCardProps) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        {/* Method badge */}
        <span className="mt-0.5 shrink-0 rounded-full bg-accent-500/15 px-2.5 py-0.5 text-xs font-semibold text-accent-500 ring-1 ring-accent-500/30">
          {method}
        </span>

        {/* Path + description */}
        <div className="min-w-0 flex-1 space-y-1">
          <PathDisplay path={path} />
          <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
        </div>
      </div>

      {/* Expandable example section */}
      {example && (
        <Disclosure>
          {({ open }) => (
            <>
              <DisclosureButton className="flex w-full items-center justify-between border-t border-border-light dark:border-border-dark px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 transition-colors hover:bg-white/[0.02] hover:text-gray-700 dark:hover:text-gray-300">
                <span>Example</span>
                <i className={`fas fa-chevron-down text-[10px] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
              </DisclosureButton>
              <DisclosurePanel className="border-t border-border-light dark:border-border-dark bg-surface-light-1 dark:bg-surface-1 p-4 space-y-3">
                <CodeBlock code={example} classes="text-xs" />
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">Preview:</span>
                  <Image
                    src={example}
                    alt="Endpoint example preview"
                    size={32}
                    className="rounded-full"
                  />
                </div>
              </DisclosurePanel>
            </>
          )}
        </Disclosure>
      )}
    </div>
  )
}
