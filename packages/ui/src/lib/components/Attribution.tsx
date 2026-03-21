import { attributionProviders } from '../attribution-providers'
import { useTheme } from '../contexts/ThemeContext'

export default function Attribution() {
  const { isDark } = useTheme()

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center italic">
        Powered by
      </p>

      <div className="flex flex-wrap max-w-sm gap-4 items-center justify-center">
        {attributionProviders.map((provider) => (
          <a
            key={provider.name}
            href={provider.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center p-0 hover:opacity-80 hover:scale-105 transition-all duration-150"
            title={provider.name}
          >
            <img
              src={
                provider.imageUrl.startsWith('http')
                  ? provider.imageUrl
                  : `/logos/${isDark ? 'dark' : 'light'}/${provider.imageUrl}`
              }
              alt={provider.name}
              width={48}
              height={24}
              className="max-h-12 max-w-24 object-contain"
            />
          </a>
        ))}
      </div>
    </div>
  )
}
