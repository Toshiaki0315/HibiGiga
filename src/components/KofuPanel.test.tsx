import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KofuPanel } from "./KofuPanel";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const convertBtn = () => screen.getByRole("button", { name: /古風に変換|変換中/ });
const placeBtn = () => screen.getByRole("button", { name: "吹き出しにして置く" });
const result = () => screen.getByLabelText("古風の文") as HTMLTextAreaElement;

describe("KofuPanel (F-K5 / F-K6)", () => {
  it("P1: the convert button is disabled for blank text", () => {
    const { rerender } = render(<KofuPanel source="  " convert={vi.fn()} onPlace={vi.fn()} />);
    expect(convertBtn()).toBeDisabled();
    rerender(<KofuPanel source="今日" convert={vi.fn()} onPlace={vi.fn()} />);
    expect(convertBtn()).toBeEnabled();
    expect(placeBtn()).toBeDisabled();
  });

  it("P2: shows progress, then the converted text", async () => {
    const d = deferred<string>();
    const convert = vi.fn(() => d.promise);
    render(<KofuPanel source="今日も疲れた。" convert={convert} onPlace={vi.fn()} />);
    fireEvent.click(convertBtn());
    expect(convert).toHaveBeenCalledWith("今日も疲れた。");
    expect(convertBtn()).toHaveTextContent("変換中");
    expect(convertBtn()).toBeDisabled();
    d.resolve("本日も疲弊せり。");
    await waitFor(() => expect(result().value).toBe("本日も疲弊せり。"));
    expect(convertBtn()).toHaveTextContent("古風に変換");
  });

  it("P3: shows an error when conversion fails and clears it on the next success", async () => {
    const convert = vi.fn().mockRejectedValueOnce(new Error("ipc down")).mockResolvedValueOnce("本日");
    render(<KofuPanel source="今日" convert={convert} onPlace={vi.fn()} />);
    fireEvent.click(convertBtn());
    expect(await screen.findByRole("alert")).toHaveTextContent("ipc down");
    fireEvent.click(convertBtn());
    await waitFor(() => expect(result().value).toBe("本日"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("P4: places the (edited) result as a bubble", async () => {
    const onPlace = vi.fn(() => true);
    render(<KofuPanel source="今日" convert={async () => "本日"} onPlace={onPlace} />);
    fireEvent.click(convertBtn());
    await waitFor(() => expect(result().value).toBe("本日"));
    fireEvent.change(result(), { target: { value: "本日も晴れなり" } });
    fireEvent.click(placeBtn());
    expect(onPlace).toHaveBeenCalledWith("本日も晴れなり");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("P5: reports when the bubble could not be placed", async () => {
    render(<KofuPanel source="今日" convert={async () => "本日"} onPlace={() => false} />);
    fireEvent.click(convertBtn());
    await waitFor(() => expect(result().value).toBe("本日"));
    fireEvent.click(placeBtn());
    expect(screen.getByRole("alert")).toHaveTextContent("絵巻に置けませぬ");
  });

  it("P6: uses the real convertKofu API by default", () => {
    render(<KofuPanel source="今日" onPlace={vi.fn()} />);
    expect(convertBtn()).toBeEnabled();
  });
});
