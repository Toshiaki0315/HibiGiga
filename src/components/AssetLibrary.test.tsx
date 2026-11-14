import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { callsOf, type RecordingContext } from "../test/fakeCanvas";
import { AssetLibrary } from "./AssetLibrary";

function setup() {
  const onDrop = vi.fn();
  const onPlace = vi.fn();
  render(<AssetLibrary onDrop={onDrop} onPlace={onPlace} />);
  return { onDrop, onPlace };
}
const item = (name: RegExp | string) => screen.getByRole("button", { name });

describe("AssetLibrary (A6)", () => {
  it("L1: shows category tabs and filters items by the selected tab", () => {
    setup();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["動物", "道具", "吹き出し"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(item("カエル（走る）")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ノートPC" })).not.toBeInTheDocument();

    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(item("ノートPC")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "カエル（走る）" })).not.toBeInTheDocument();
  });

  it("L2: draws a thumbnail for each item", () => {
    setup();
    const canvas = item("カエル（走る）").querySelector("canvas")!;
    const ctx = canvas.getContext("2d") as unknown as RecordingContext;
    expect(callsOf(ctx, "translate").length).toBeGreaterThan(0);
    expect(callsOf(ctx, "arc").length).toBeGreaterThan(0);
  });

  it("L3: dragging shows a ghost under the pointer and drops at the release point", () => {
    const { onDrop, onPlace } = setup();
    const el = item("ウサギ（走る）");
    el.setPointerCapture = vi.fn();
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10, pointerId: 4 });
    expect(el.setPointerCapture).toHaveBeenCalledWith(4);
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
    fireEvent.pointerMove(el, { clientX: 300, clientY: 200 });
    const ghost = screen.getByTestId("drag-ghost");
    expect(ghost).toHaveStyle({ left: "300px", top: "200px" });
    expect(ghost).toHaveTextContent("ウサギ（走る）");
    fireEvent.pointerUp(el, { clientX: 310, clientY: 205 });
    expect(onDrop).toHaveBeenCalledWith("rabbit-run", 310, 205);
    expect(onPlace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
  });

  it("L4: a tap without moving places the item at the center instead", () => {
    const { onDrop, onPlace } = setup();
    const el = item("猿（走る）");
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(el, { clientX: 12, clientY: 11 });
    fireEvent.pointerUp(el, { clientX: 12, clientY: 11 });
    expect(onPlace).toHaveBeenCalledWith("monkey-run");
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("L5: Enter or Space places the focused item", () => {
    const { onPlace } = setup();
    fireEvent.keyDown(item("カエル（走る）"), { key: "Enter" });
    fireEvent.keyDown(item("カエル（走る）"), { key: " " });
    fireEvent.keyDown(item("カエル（走る）"), { key: "a" });
    expect(onPlace).toHaveBeenCalledTimes(2);
  });

  it("L6: pointercancel aborts the drag", () => {
    const { onDrop, onPlace } = setup();
    const el = item("カエル（走る）");
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(el, { clientX: 200, clientY: 200 });
    fireEvent.pointerCancel(el, {});
    fireEvent.pointerUp(el, { clientX: 200, clientY: 200 });
    expect(onDrop).not.toHaveBeenCalled();
    expect(onPlace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
  });

  it("L7: pointer moves without a press do nothing", () => {
    setup();
    fireEvent.pointerMove(item("カエル（走る）"), { clientX: 200, clientY: 200 });
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
  });
});
