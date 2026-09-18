import { CATEGORY_COLOR, PAINTED, formatTime, type Slice } from "./types.ts";

/** Below this a slice is noise, and painting content would tint the whole bar. */
export const PAINT_FLOOR = 0.2;
export const MAX_OPACITY = 0.85;

export function paintable(slice: Slice, floor = PAINT_FLOOR): boolean {
  return PAINTED.includes(slice.category) && slice.p >= floor;
}

export interface BarHandle {
  update(slices: Slice[], duration: number): void;
  destroy(): void;
  readonly element: HTMLElement;
}

const pct = (value: number) => `${(Math.max(0, Math.min(1, value)) * 100).toFixed(4)}%`;

/**
 * Slices are absolutely positioned <li> in a container over .ytp-progress-bar, the
 * mechanics SponsorBlock uses (src/js-components/previewBar.ts:409-443). The semantics are
 * ours: one hue per category, opacity from probability, so a borderline sponsor is a ghost.
 */
export function mountBar(progressBar: HTMLElement): BarHandle {
  const doc = progressBar.ownerDocument;
  const list = doc.createElement("ul");
  list.className = "jev-skip-bar";
  list.style.cssText =
    "position:absolute;inset:0;margin:0;padding:0;list-style:none;pointer-events:none;z-index:1;";

  const tip = doc.createElement("div");
  tip.className = "jev-skip-tip";
  tip.style.cssText =
    "position:absolute;bottom:14px;display:none;max-width:280px;padding:6px 8px;border-radius:6px;" +
    "background:#11131a;color:#e6e9f0;font:12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;" +
    "box-shadow:0 4px 16px rgba(0,0,0,.5);pointer-events:none;z-index:2;transform:translateX(-50%);white-space:normal;";
  list.append(tip);
  progressBar.append(list);

  return {
    element: list,
    update(slices, duration) {
      for (const node of Array.from(list.querySelectorAll("li"))) node.remove();
      if (!(duration > 0)) return;
      for (const slice of slices) {
        if (!paintable(slice)) continue;
        const li = doc.createElement("li");
        li.dataset.category = slice.category;
        li.dataset.p = slice.p.toFixed(2);
        li.style.cssText = "position:absolute;top:0;bottom:0;pointer-events:auto;";
        li.style.left = pct(slice.start / duration);
        li.style.right = pct(1 - Math.min(slice.end, duration) / duration);
        li.style.backgroundColor = CATEGORY_COLOR[slice.category];
        li.style.opacity = String(Math.min(MAX_OPACITY, Math.max(PAINT_FLOOR, slice.p)));
        // The v0.2 "why" tooltip, pulled forward: the text behind the slice is the whole
        // argument for trusting a probability nobody voted on.
        li.addEventListener("mouseenter", () => {
          tip.textContent = `${slice.category} ${Math.round(slice.p * 100)}% at ${formatTime(slice.start)} · ${slice.text.slice(0, 80)}`;
          tip.style.left = li.style.left;
          tip.style.display = "block";
        });
        li.addEventListener("mouseleave", () => {
          tip.style.display = "none";
        });
        list.append(li);
      }
    },
    destroy() {
      list.remove();
    },
  };
}
