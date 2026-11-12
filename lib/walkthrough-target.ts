/** Targets on shell chrome (nav, FAB, header buttons) — not in-page duplicates inside `<main>`. */
const SHELL_WALKTHROUGH_TARGETS = new Set([
  "app-nav",
  "new-transaction",
  "scan-receipt",
  "transaction-mode-btn",
])

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
  if (nodes.length === 1) {
    return isVisibleWalkthroughAnchor(nodes[0]) ? nodes[0] : null
  }

  const visibleNodes = [...nodes].filter(isVisibleWalkthroughAnchor)
  const pool = visibleNodes.length > 0 ? visibleNodes : [...nodes]

  if (SHELL_WALKTHROUGH_TARGETS.has(target)) {
    const bottomNav = pool.filter((el) => {
      const nav = el.closest("nav")
      return nav?.classList.contains("fixed") === true
    })
    if (bottomNav.length > 0) return bottomNav[bottomNav.length - 1]

    const outsideMain = pool.filter((el) => !el.closest("main"))
    if (outsideMain.length > 0) return outsideMain[0]
  }

  const inMain = pool.filter((el) => el.closest("main"))
  if (inMain.length > 0) return inMain[0]

  return pool[pool.length - 1] ?? nodes[0]
}
