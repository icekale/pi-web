const ANCHORED_MENU_GAP = 8;

export function getUpwardMenuMaxHeight(menuBottom: number, visibleTop: number, gap = ANCHORED_MENU_GAP): number {
  return Math.max(0, Math.floor(menuBottom - visibleTop - gap));
}

export function cycleListIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

export function getVisibleTopBoundary(element: HTMLElement): number {
  let visibleTop = window.visualViewport?.offsetTop ?? 0;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      visibleTop = Math.max(visibleTop, parent.getBoundingClientRect().top + parent.clientTop);
    }
  }
  return visibleTop;
}

export function subscribeUpwardMenuMaxHeight(
  menu: HTMLElement,
  onChange: (maxHeight: number) => void,
): () => void {
  let frameId: number | null = null;
  const overflowParents: HTMLElement[] = [];
  for (let parent = menu.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      overflowParents.push(parent);
    }
  }
  const update = () => {
    frameId = null;
    onChange(getUpwardMenuMaxHeight(
      menu.getBoundingClientRect().bottom,
      getVisibleTopBoundary(menu),
    ));
  };
  const scheduleUpdate = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(update);
  };
  update();
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
  if (menu.parentElement) observer?.observe(menu.parentElement);
  for (const parent of overflowParents) observer?.observe(parent);
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", scheduleUpdate);
  viewport?.addEventListener("scroll", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("scroll", scheduleUpdate, true);
  return () => {
    observer?.disconnect();
    viewport?.removeEventListener("resize", scheduleUpdate);
    viewport?.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    window.removeEventListener("scroll", scheduleUpdate, true);
    if (frameId !== null) cancelAnimationFrame(frameId);
  };
}
