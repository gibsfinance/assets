import { attributionProviders } from '../attribution-providers'
import { useTheme } from '../contexts/ThemeContext'
import Image from './Image'

const CONTAINER_SIZE = 40

export default function Attribution() {
  const { isDark } = useTheme()

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center italic">
        Powered by
      </p>

      <div className="flex flex-wrap max-w-md gap-3 items-center justify-center">
        {attributionProviders.map((provider) => (
          <a
            key={provider.name}
            href={provider.link}
            target="_blank"
            rel="noopener noreferrer"
            title={provider.name}
            className="flex items-center justify-center rounded-lg bg-gray-50 dark:bg-surface-2 hover:bg-gray-100 dark:hover:bg-surface-3 transition-colors"
            style={{ width: CONTAINER_SIZE, height: CONTAINER_SIZE }}
          >
            <Image
              src={
                provider.imageUrl.startsWith('http')
                  ? provider.imageUrl
                  : `/logos/${isDark ? 'dark' : 'light'}/${provider.imageUrl}`
              }
              alt={provider.name}
              size={24}
              skeleton
              shape="rect"
              lazy
              className="object-contain"
            />
          </a>
        ))}
      </div>
    </div>
  )
}
