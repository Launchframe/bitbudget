/** Prefer a visible in-page walkthrough anchor when ids are duplicated in nav + content. */
export function findWalkthroughTarget(target: string): Element | null {
  const nodes = document.querySelectorAll(`[data-walkthrough="${target}"]`)
  if (nodes.length === 0) return null
  if (nodes.length === 1) return nodes[0]

  for (const el of nodes) {
    if (el.closest("main")) return el
  }

  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }

  for (let i = nodes.length - 1; i >= 0; i--) {
    if (visible(nodes[i])) return nodes[i]
  }

  return nodes[0]
}
