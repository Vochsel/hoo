import { useEffect, useState } from 'react'

export function useGitHubStars() {
  const [stars, setStars] = useState<number | null>(null)

  useEffect(() => {
    fetch('https://api.github.com/repos/Vochsel/hoo')
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.stargazers_count === 'number') {
          setStars(data.stargazers_count)
        }
      })
      .catch(() => {})
  }, [])

  const formatted = stars !== null ? new Intl.NumberFormat().format(stars) : null

  return { stars, formatted }
}
