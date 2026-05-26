function isVisibleWalkthroughAnchor(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  if (typeof window !== "undefined") {
    const style = window.getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") return false
  }
  return true
}

/** Prefer a visible in-page walkthrough anchor when ids are duplicated in nav + content. */
export function findWalkthroughTarget(target: string): Element | null {
  const nodes = document.querySelectorAll(`[data-walkthrough="${target}"]`)
  if (nodes.length === 0) return null
  if (nodes.length === 1) return nodes[0]

  const visibleNodes = [...nodes].filter(isVisibleWalkthroughAnchor)
  const pool = visibleNodes.length > 0 ? visibleNodes : [...nodes]

  const inMain = pool.filter((el) => el.closest("main"))
  if (inMain.length > 0) return inMain[0]

  return pool[pool.length - 1] ?? nodes[0]
}
