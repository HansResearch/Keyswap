import { useState, useEffect } from 'react'
import { fetchSolPrice } from './api'

export function useSolPrice(): number {
  const [price, setPrice] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const p = await fetchSolPrice()
      if (!cancelled && p > 0) setPrice(p)
    }
    load()
    const id = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return price
}
