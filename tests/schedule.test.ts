import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScheduler, type VideoLike } from "../lib/schedule.ts";
import type { Slice } from "../lib/types.ts";

class FakeVideo extends EventTarget implements VideoLike {
  currentTime = 0;
  playbackRate = 1;
  paused = false;
}

const slice = (over: Partial<Slice>): Slice => ({
  id: "s001",
  start: 60,
  end: 102,
  category: "sponsor",
  p: 0.93,
  text: "brought to you by",
  ...over,
});

let video: FakeVideo;

beforeEach(() => {
  vi.useFakeTimers();
  video = new FakeVideo();
});
afterEach(() => vi.useRealTimers());

describe("skip scheduler", () => {
  it("arms one timer and lands currentTime on the segment end", () => {
    const skipped: Slice[] = [];
    const scheduler = createScheduler(video, {
      threshold: 0.85,
      autoSkip: true,
      onSkip: (s) => skipped.push(s),
    });
    scheduler.setSlices([slice({}), slice({ id: "s002", start: 200, end: 230 })]);
    expect(scheduler.pending()).toBe(60);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(59_850);
    expect(video.currentTime).toBe(102);
    expect(skipped.map((s) => s.id)).toEqual(["s001"]);
    expect(scheduler.pending()).toBe(200);
    scheduler.destroy();
  });

  it("re-arms on seek", () => {
    const scheduler = createScheduler(video, { threshold: 0.85, autoSkip: true });
    scheduler.setSlices([slice({})]);
    expect(scheduler.pending()).toBe(60);
    video.currentTime = 110;
    video.dispatchEvent(new Event("seeked"));
    expect(scheduler.pending()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    video.currentTime = 10;
    video.dispatchEvent(new Event("seeked"));
    expect(scheduler.pending()).toBe(60);
    scheduler.destroy();
  });

  it("skips immediately when a seek lands inside a segment", () => {
    const scheduler = createScheduler(video, { threshold: 0.85, autoSkip: true });
    scheduler.setSlices([slice({})]);
    video.currentTime = 70;
    video.dispatchEvent(new Event("seeked"));
    expect(video.currentTime).toBe(102);
    scheduler.destroy();
  });

  it("arms nothing below the threshold, for content, or when auto-skip is off", () => {
    const scheduler = createScheduler(video, { threshold: 0.85, autoSkip: true });
    scheduler.setSlices([slice({ p: 0.84 }), slice({ id: "s002", category: "content", p: 0.99 })]);
    expect(scheduler.pending()).toBeNull();
    scheduler.setSlices([slice({ p: 0.86 })]);
    expect(scheduler.pending()).toBe(60);
    scheduler.setOptions({ autoSkip: false });
    expect(scheduler.pending()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    scheduler.destroy();
  });

  it("accounts for playback rate and drops the timer on pause", () => {
    const scheduler = createScheduler(video, { threshold: 0.85, autoSkip: true, leadMs: 150 });
    video.playbackRate = 2;
    scheduler.setSlices([slice({})]);
    vi.advanceTimersByTime(29_800);
    expect(video.currentTime).toBe(0);
    vi.advanceTimersByTime(100);
    expect(video.currentTime).toBe(102);
    video.paused = true;
    video.dispatchEvent(new Event("pause"));
    expect(vi.getTimerCount()).toBe(0);
    scheduler.destroy();
  });
});
