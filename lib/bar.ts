import { CATEGORY_COLOR, PAINTED, formatTime, type Category, type Slice } from "./types.ts";

/** Below this a slice is noise, and painting content would tint the whole bar. */
export const PAINT_FLOOR = 0.2;
export const MAX_OPACITY = 0.85;

/**
 * Measured on a watch page 2026-09-19: inside .ytp-progress-bar YouTube stacks chapters at
 * 32, clip excludes at 37, timed markers at 40 and the scrubber at 43. Below 40 the slices
 * hide under YouTube's own layers and the markers container swallows every hover, which is
 * what a z-index of 1 did. Above the scrubber the drag handle would disappear.
 */
export const BAR_Z = 42;

/** A batch fades in over this long, end to end. Long enough to read, short enough to miss. */
export const PAINT_IN_MS = 400;

/** What a slice is drawn on top of: YouTube's own bar, which is translucent over video. */
const BASE_RGB = [36, 40, 51] as const;

const hexRgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/**
 * Probability as colour strength against a fixed base, rather than as transparency over
 * whatever frame is playing. Opacity let the video through, so the heatmap read as noise
 * on a bright scene and vanished on a dark one; this keeps a faint slice faint and a
 * confident one solid no matter what is behind it.
 */
export function sliceColor(category: Category, p: number): string {
  const strength = Math.min(MAX_OPACITY, Math.max(PAINT_FLOOR, p));
  const [r, g, b] = hexRgb(CATEGORY_COLOR[category]);
  const mix = (base: number, target: number) => Math.round(base + (target - base) * strength);
  return `rgb(${mix(BASE_RGB[0], r)}, ${mix(BASE_RGB[1], g)}, ${mix(BASE_RGB[2], b)})`;
}

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
 * The tooltip is centred with translateX(-50%), so half its width has to fit on each side.
 * Returns a percentage, clamped so neither edge leaves the bar.
 */
export function clampTip(leftPercent: number, bar: HTMLElement, tip: HTMLElement): string {
  const barWidth = bar.getBoundingClientRect().width;
  const tipWidth = tip.getBoundingClientRect().width || 280;
  if (!barWidth) return `${leftPercent}%`;
  const half = (tipWidth / 2 / barWidth) * 100;
  return `${Math.min(100 - half, Math.max(half, leftPercent)).toFixed(2)}%`;
}

/**
 * Centre x of a slice, in pixels inside the host, clamped so the tooltip stays on screen.
 * The tooltip hangs off the player rather than the progress bar: inside the bar it sits in
 * a stacking context YouTube's own seek preview beats, so it ends up behind the thumbnail.
 */
export function tipLeftPx(slice: DOMRect, host: DOMRect, tipWidth: number): number {
  const centre = slice.left + slice.width / 2 - host.left;
  const half = tipWidth / 2;
  return Math.round(Math.min(host.width - half, Math.max(half, centre)));
}

/**
 * Slices are absolutely positioned <li> in a container over .ytp-progress-bar, the
 * mechanics SponsorBlock uses (src/js-components/previewBar.ts:409-443). The semantics are
 * ours: one hue per category, colour strength from probability, so a borderline sponsor is
 * a ghost and a confident one is solid.
 */
export interface BarOptions {
  /** Budget for a whole batch to fade in. The eye reads the bar filling; the clock doesn't. */
  paintInMs?: number;
}

export function mountBar(progressBar: HTMLElement, options: BarOptions = {}): BarHandle {
  const paintInMs = options.paintInMs ?? PAINT_IN_MS;
  const doc = progressBar.ownerDocument;
  /** Slice id to node, so an answer that already landed is never repainted. */
  const nodes = new Map<string, HTMLLIElement>();
  /** Which batch of answers a slice arrived in, which is what the paint-in is showing. */
  let batch = 0;
  const list = doc.createElement("ul");
  list.className = "jev-skip-bar";
  list.style.cssText =
    `position:absolute;inset:0;margin:0;padding:0;list-style:none;pointer-events:none;z-index:${BAR_Z};`;

  // The player, so the tooltip can sit above YouTube's seek preview instead of behind it.
  const host = progressBar.closest<HTMLElement>(".html5-video-player") ?? progressBar;
  const tip = doc.createElement("div");
  tip.className = "jev-skip-tip";
  tip.style.cssText =
    "position:absolute;bottom:64px;display:none;width:280px;padding:7px 9px;border-radius:7px;" +
    "background:#11131af2;color:#e6e9f0;font:12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;" +
    "box-shadow:0 6px 22px rgba(0,0,0,.6);pointer-events:none;z-index:2147483646;transform:translateX(-50%);white-space:normal;";
  host.append(tip);
  progressBar.append(list);

  return {
    element: list,
    update(slices, duration) {
      // A hovered node can be removed below, and nothing would ever hide its tooltip.
      tip.style.display = "none";
      // A live stream reports Infinity, which is > 0 and would put every slice at zero width.
      const usable = duration > 0 && Number.isFinite(duration);
      const painted = usable ? slices.filter((s) => paintable(s)) : [];
      const keep = new Set(painted.map((s) => s.id));
      for (const [id, node] of nodes) {
        if (keep.has(id)) continue;
        node.remove();
        nodes.delete(id);
      }

      // Answers land in batches, so a batch fades in together rather than one slice at a
      // time. Slices already on the bar keep their node and never re-animate.
      const arriving = painted.filter((s) => !nodes.has(s.id));
      const step = arriving.length > 1 ? paintInMs / (arriving.length - 1) : 0;
      let index = 0;
      if (arriving.length) batch += 1;

      for (const slice of painted) {
        const existing = nodes.get(slice.id);
        const li = existing ?? doc.createElement("li");
        li.dataset.category = slice.category;
        li.dataset.p = slice.p.toFixed(2);
        const colour = sliceColor(slice.category, slice.p);
        if (!existing) {
          li.style.cssText =
            `position:absolute;top:0;bottom:0;pointer-events:auto;opacity:0;` +
            `transition:opacity ${(paintInMs / 1000).toFixed(2)}s ease;`;
          li.style.transitionDelay = `${((index * step) / 1000).toFixed(3)}s`;
          li.dataset.batch = String(batch);
          index += 1;
        }
        li.style.left = pct(slice.start / duration);
        li.style.right = pct(1 - Math.min(slice.end, duration) / duration);
        li.style.backgroundColor = colour;
        // The v0.2 "why" tooltip, pulled forward: the text behind the slice is the whole
        // argument for trusting a probability nobody voted on.
        li.onmouseenter = () => {
          tip.textContent = `${slice.category} ${Math.round(slice.p * 100)}% at ${formatTime(slice.start)} · ${slice.text.slice(0, 80)}`;
          tip.style.display = "block";
          // Centred on the slice, but never hanging off the edge: there it wrapped into an
          // unreadable column, which is what the first demo take caught.
          tip.style.left = `${tipLeftPx(li.getBoundingClientRect(), host.getBoundingClientRect(), tip.getBoundingClientRect().width || 280)}px`;
        };
        li.onmouseleave = () => {
          tip.style.display = "none";
        };
        if (!existing) {
          list.append(li);
          nodes.set(slice.id, li);
          // Reading a layout property flushes the opacity:0 start, so the transition has
          // somewhere to run from. Without it the browser collapses both values into one.
          void li.offsetWidth;
        }
        li.style.opacity = "1";
      }
    },
    destroy() {
      nodes.clear();
      tip.remove();
      list.remove();
    },
  };
}
