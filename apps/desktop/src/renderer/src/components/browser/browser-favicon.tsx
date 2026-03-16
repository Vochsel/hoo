import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'

interface BrowserFaviconProps {
  src?: string | null
  imgClassName: string
  iconClassName?: string
}

export function BrowserFavicon({
  src,
  imgClassName,
  iconClassName
}: BrowserFaviconProps): React.ReactElement {
  const normalizedSrc = typeof src === 'string' ? src.trim() : ''
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  useEffect(() => {
    setFailedSrc(null)
  }, [normalizedSrc])

  if (!normalizedSrc || failedSrc === normalizedSrc) {
    return <Globe className={iconClassName ?? imgClassName} />
  }

  return (
    <img
      src={normalizedSrc}
      alt=""
      draggable={false}
      className={imgClassName}
      onError={() => setFailedSrc(normalizedSrc)}
    />
  )
}
