// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { mountBar } from "../lib/bar.ts";
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

  it("paints nothing when the duration is not known yet", () => {
    const bar = mountBar(progress);
    bar.update([slice({})], 0);
    expect(progress.querySelectorAll("li")).toHaveLength(0);
    bar.destroy();
  });
});
