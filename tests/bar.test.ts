// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clampTip, mountBar, tipLeftPx } from "../lib/bar.ts";
import { CATEGORY_COLOR, type Slice } from "../lib/types.ts";

const slice = (over: Partial<Slice>): Slice => ({
  id: "s001",
  start: 0,
  end: 30,
  category: "sponsor",
  p: 0.9,
  text: "this video is brought to you by Nordpass and the code is LAMPS20 which is a long line of text",
  ...over,
});

let progress: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div class="ytp-progress-bar"></div>';
  progress = document.querySelector(".ytp-progress-bar")!;
});

describe("seek bar", () => {
  it("paints one li per judged segment, positioned by percentage of duration", () => {
    const bar = mountBar(progress);
    bar.update([slice({ start: 30, end: 60, p: 0.93 })], 120);
    const items = progress.querySelectorAll("li");
    expect(items).toHaveLength(1);
    expect(items[0].style.left).toBe("25%");
    expect(items[0].style.right).toBe("50%");
    expect(items[0].style.backgroundColor).toBe("rgb(255, 77, 106)");
    expect(items[0].style.opacity).toBe("0.85");
    bar.destroy();
  });

  it("paints nothing for content, other, or a probability under the floor", () => {
    const bar = mountBar(progress);
    bar.update(
      [
        slice({ id: "a", category: "content", p: 0.99 }),
        slice({ id: "b", category: "other", p: 0.99 }),
        slice({ id: "c", category: "sponsor", p: 0.12 }),
        slice({ id: "d", category: "intro", p: 0.21 }),
      ],
      120,
    );
    const items = progress.querySelectorAll("li");
    expect(items).toHaveLength(1);
    expect(items[0].dataset.category).toBe("intro");
    expect(items[0].style.opacity).toBe("0.21");
    expect(items[0].style.backgroundColor).toBe("rgb(169, 140, 255)");
    expect(CATEGORY_COLOR.intro).toBe("#a98cff");
    bar.destroy();
  });

  it("shows the why tooltip on hover and hides it on leave", () => {
    const bar = mountBar(progress);
    bar.update([slice({ start: 90, p: 0.77 })], 300);
    const item = progress.querySelector("li")!;
    const tip = progress.querySelector(".jev-skip-tip") as HTMLElement;
    item.dispatchEvent(new MouseEvent("mouseenter"));
    expect(tip.style.display).toBe("block");
    expect(tip.textContent).toContain("sponsor 77%");
    expect(tip.textContent).toContain("at 1:30");
    expect(tip.textContent!.split("· ")[1]).toHaveLength(80);
    item.dispatchEvent(new MouseEvent("mouseleave"));
    expect(tip.style.display).toBe("none");
    bar.destroy();
  });

  it("leaves no nodes behind after two navigations", () => {
    for (let i = 0; i < 2; i++) {
      const bar = mountBar(progress);
      bar.update([slice({})], 120);
      bar.destroy();
    }
    expect(progress.childElementCount).toBe(0);
  });

  it("stacks above YouTube's timed markers and below its scrubber", () => {
    const bar = mountBar(progress);
    const z = Number((progress.querySelector(".jev-skip-bar") as HTMLElement).style.zIndex);
    // Measured layers on a real watch page: markers 40, scrubber 43.
    expect(z).toBeGreaterThan(40);
    expect(z).toBeLessThan(43);
    bar.destroy();
  });

  it("paints nothing when the duration is not known yet", () => {
    const bar = mountBar(progress);
    bar.update([slice({})], 0);
    expect(progress.querySelectorAll("li")).toHaveLength(0);
    bar.destroy();
  });
});

describe("seek bar, after the review", () => {
  it("hides a tooltip whose slice is about to be rebuilt", () => {
    const bar = mountBar(progress);
    bar.update([slice({ start: 30, end: 60 })], 120);
    const tip = progress.querySelector(".jev-skip-tip") as HTMLElement;
    progress.querySelector("li")!.dispatchEvent(new MouseEvent("mouseenter"));
    expect(tip.style.display).toBe("block");
    // Answers arrive in batches, so update() runs many times per video.
    bar.update([slice({ start: 30, end: 60 }), slice({ id: "s002", start: 90, end: 120 })], 120);
    expect(tip.style.display).toBe("none");
    bar.destroy();
  });

  it("paints nothing on a live stream, where duration is Infinity", () => {
    const bar = mountBar(progress);
    bar.update([slice({})], Infinity);
    expect(progress.querySelectorAll("li")).toHaveLength(0);
    bar.destroy();
  });
});

describe("seek bar, painting for the camera", () => {
  it("keeps the node for a slice it already painted and animates only the new one", () => {
    const bar = mountBar(progress);
    bar.update([slice({ id: "s001", start: 30, end: 60 })], 300);
    const first = progress.querySelector("li")!;
    bar.update(
      [slice({ id: "s001", start: 30, end: 60 }), slice({ id: "s002", start: 90, end: 120 })],
      300,
    );
    const items = progress.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toBe(first);
    expect(items[0].dataset.batch).toBe("1");
    expect(items[1].dataset.batch).toBe("2");
    bar.destroy();
  });

  it("staggers a batch inside the paint-in budget", () => {
    const bar = mountBar(progress, { paintInMs: 400 });
    bar.update(
      Array.from({ length: 8 }, (_, i) => slice({ id: `s${i}`, start: i * 30, end: i * 30 + 30 })),
      300,
    );
    const delays = [...progress.querySelectorAll("li")].map((li) =>
      Number.parseFloat((li as HTMLElement).style.transitionDelay),
    );
    expect(delays[0]).toBe(0);
    expect(Math.max(...delays)).toBeLessThanOrEqual(0.4);
    expect(delays).toStrictEqual([...delays].sort((a, b) => a - b));
    bar.destroy();
  });
});

describe("the why tooltip near the ends of the bar", () => {
  it("keeps the tooltip on the bar at either edge", () => {
    const bar = mountBar(progress);
    const list = progress.querySelector(".jev-skip-bar") as HTMLElement;
    const tip = document.querySelector(".jev-skip-tip") as HTMLElement;
    // jsdom has no layout, so the two widths come from stubs.
    list.getBoundingClientRect = () => ({ width: 1000 }) as DOMRect;
    tip.getBoundingClientRect = () => ({ width: 280 }) as DOMRect;
    // 280px of tooltip on a 1000px bar needs 14% of clearance on each side.
    expect(clampTip(0, list, tip)).toBe("14.00%");
    expect(clampTip(100, list, tip)).toBe("86.00%");
    expect(clampTip(50, list, tip)).toBe("50.00%");
    bar.destroy();
  });

  it("keeps the tooltip inside the player at either end", () => {
    const host = { left: 0, width: 1000 } as DOMRect;
    // A slice at the far left would centre the 280px tooltip at 10px and hang off.
    expect(tipLeftPx({ left: 0, width: 20 } as DOMRect, host, 280)).toBe(140);
    expect(tipLeftPx({ left: 980, width: 20 } as DOMRect, host, 280)).toBe(860);
    expect(tipLeftPx({ left: 480, width: 40 } as DOMRect, host, 280)).toBe(500);
  });
});
