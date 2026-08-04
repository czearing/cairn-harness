export const tabbableSelector = "button, textarea, input, select, a[href], [contenteditable]:not([contenteditable='false']), [tabindex]";

export function eligibleDescendants(root: HTMLElement, selector = tabbableSelector) {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((element) =>
    element.tabIndex >= 0
    && !element.matches(":disabled")
    && !element.closest("[inert], [aria-hidden='true']")
    && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
  );
}
