import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StampMeta } from "../api/stamps";
import { ImageImportError } from "../assets/imageImport";
import { UserAssetStore, type UserAssetApi } from "../assets/userAssets";
import { setUserAssetResolver } from "../emaki/stampRender";
import { AssetLibrary } from "./AssetLibrary";

const meta = (id: string, name = id): StampMeta => ({
  id,
  name,
  width: 200,
  height: 100,
  style: "original",
  createdAt: "2026-11-15T21:00:00+09:00",
});

async function setup(list: StampMeta[] = [], opts: { confirm?: boolean } = {}) {
  const api = {
    listStamps: vi.fn(async () => list),
    loadStampImage: vi.fn(async () => "b64"),
    importStamp: vi.fn(async (name: string) => meta("new", name)),
    deleteStamp: vi.fn(async () => {}),
  } satisfies UserAssetApi;
  const store = new UserAssetStore(api, async () => ({}) as CanvasImageSource);
  await store.init();
  setUserAssetResolver(store);
  const onDrop = vi.fn();
  const onPlace = vi.fn();
  const prepare = vi.fn(async () => ({ pngBase64: "iVBOR", width: 200, height: 100 }));
  const confirmDelete = vi.fn(() => opts.confirm ?? true);
  render(
    <AssetLibrary
      onDrop={onDrop}
      onPlace={onPlace}
      userAssets={store}
      prepare={prepare}
      confirmDelete={confirmDelete}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "自作" }));
  return { api, store, onDrop, onPlace, prepare, confirmDelete };
}

const pickFile = (name = "猫の写真.jpg") => {
  const file = new File(["x"], name, { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText("画像を取り込む"), { target: { files: [file] } });
  return file;
};

describe("AssetLibrary 自作 tab (I6)", () => {
  it("L8: shows the user tab and an empty-state message", async () => {
    await setup();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["動物", "道具", "吹き出し", "自作"]);
    expect(screen.getByText(/まだ自作のスタンプはありませぬ/)).toBeInTheDocument();
  });

  it("L9: picking a file prepares it, then imports with the chosen name and style", async () => {
    const { api, prepare } = await setup();
    const file = pickFile();
    await waitFor(() => expect(prepare).toHaveBeenCalledWith(file));
    const name = (await screen.findByLabelText("名前")) as HTMLInputElement;
    expect(name.value).toBe("猫の写真");
    expect(screen.getByLabelText("そのまま")).toBeChecked();
    fireEvent.change(name, { target: { value: "うちの猫" } });
    fireEvent.click(screen.getByLabelText("墨絵風"));
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));
    await waitFor(() => expect(api.importStamp).toHaveBeenCalledWith("うちの猫", "iVBOR", "ink"));
    expect(await screen.findByRole("button", { name: "うちの猫" })).toBeInTheDocument();
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
  });

  it("L10: やめる cancels the import", async () => {
    const { api } = await setup();
    pickFile();
    await screen.findByLabelText("名前");
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(screen.queryByLabelText("名前")).not.toBeInTheDocument();
    expect(api.importStamp).not.toHaveBeenCalled();
  });

  it("L11: shows errors from preparing and from importing", async () => {
    const { api, prepare } = await setup();
    prepare.mockRejectedValueOnce(new ImageImportError("PNG・JPEG・WebP の画像のみ取り込めます"));
    pickFile("a.svg");
    expect(await screen.findByRole("alert")).toHaveTextContent("PNG・JPEG・WebP");

    api.importStamp.mockRejectedValueOnce(new Error("disk full"));
    pickFile();
    await screen.findByLabelText("名前");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getByLabelText("名前")).toBeInTheDocument();
  });

  it("L11: ignores an empty file selection", async () => {
    const { prepare } = await setup();
    fireEvent.change(screen.getByLabelText("画像を取り込む"), { target: { files: [] } });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("L12: user stamps can be dragged or tapped like other assets", async () => {
    const { onDrop, onPlace } = await setup([meta("u1", "猫")]);
    const el = screen.getByRole("button", { name: "猫" });
    fireEvent.pointerDown(el, { clientX: 5, clientY: 5 });
    fireEvent.pointerMove(el, { clientX: 300, clientY: 100 });
    fireEvent.pointerUp(el, { clientX: 300, clientY: 100 });
    expect(onDrop).toHaveBeenCalledWith("user:u1", 300, 100);
    fireEvent.pointerDown(el, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(el, { clientX: 5, clientY: 5 });
    expect(onPlace).toHaveBeenCalledWith("user:u1");
  });

  it("L13: deleting asks for confirmation", async () => {
    const { api, confirmDelete } = await setup([meta("u1", "猫")], { confirm: false });
    fireEvent.click(screen.getByRole("button", { name: "猫を削除" }));
    expect(confirmDelete).toHaveBeenCalledWith("猫");
    expect(api.deleteStamp).not.toHaveBeenCalled();
    confirmDelete.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "猫を削除" }));
    await waitFor(() => expect(api.deleteStamp).toHaveBeenCalledWith("u1"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "猫" })).not.toBeInTheDocument());
  });

  it("L13: shows an error when deleting fails", async () => {
    const { api } = await setup([meta("u1", "猫")]);
    api.deleteStamp.mockRejectedValueOnce(new Error("busy"));
    fireEvent.click(screen.getByRole("button", { name: "猫を削除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("busy");
  });

  it("L14: redraws thumbnails when an image finishes loading", async () => {
    const { store } = await setup([meta("u1", "猫")]);
    const before = store.getSnapshot().version;
    await act(async () => {
      store.image("u1");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(store.getSnapshot().version).toBeGreaterThan(before);
    expect(screen.getByRole("button", { name: "猫" }).querySelector("canvas")).toBeInTheDocument();
  });
});
