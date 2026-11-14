import { describe, expect, it, vi } from "vitest";
import type { StampMeta } from "../api/stamps";
import { UserAssetStore, parseUserAssetId, userAssetId, type UserAssetApi } from "./userAssets";

const meta = (id: string, o: Partial<StampMeta> = {}): StampMeta => ({
  id,
  name: id,
  width: 100,
  height: 50,
  style: "original",
  createdAt: "2026-11-15T21:00:00+09:00",
  ...o,
});

function setup(list: StampMeta[] = [meta("a")]) {
  const api = {
    listStamps: vi.fn(async () => list),
    loadStampImage: vi.fn(async (id: string) => `b64-${id}`),
    importStamp: vi.fn(async (name: string) => meta("new", { name })),
    deleteStamp: vi.fn(async () => {}),
  } satisfies UserAssetApi;
  const loadImage = vi.fn(async (b64: string) => ({ img: b64 }) as unknown as CanvasImageSource);
  const store = new UserAssetStore(api, loadImage);
  return { api, loadImage, store };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("user asset ids", () => {
  it("prefixes and parses user: asset ids", () => {
    expect(userAssetId("abc")).toBe("user:abc");
    expect(parseUserAssetId("user:abc")).toBe("abc");
    expect(parseUserAssetId("frog-run")).toBeNull();
  });
});

describe("UserAssetStore (I3)", () => {
  it("loads the list on init", async () => {
    const { store } = setup();
    expect(store.getSnapshot()).toMatchObject({ ready: false, stamps: [] });
    await store.init();
    expect(store.getSnapshot()).toMatchObject({ ready: true, stamps: [meta("a")] });
    expect(store.meta("a")).toEqual(meta("a"));
    expect(store.meta("zzz")).toBeUndefined();
  });

  it("reports a failure to list", async () => {
    const { api, store } = setup();
    api.listStamps.mockRejectedValueOnce(new Error("no access"));
    await store.init();
    expect(store.getSnapshot()).toMatchObject({ ready: true, stamps: [], error: "no access" });
  });

  it("loads images lazily, once, and bumps the version when loaded", async () => {
    const { api, loadImage, store } = setup();
    await store.init();
    const v0 = store.getSnapshot().version;
    expect(store.image("a")).toBeUndefined();
    expect(store.image("a")).toBeUndefined();
    await flush();
    expect(api.loadStampImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith("b64-a");
    expect(store.image("a")).toEqual({ img: "b64-a" });
    expect(store.getSnapshot().version).toBe(v0 + 1);
  });

  it("does not retry an image that failed to load", async () => {
    const { api, store } = setup();
    await store.init();
    api.loadStampImage.mockRejectedValueOnce(new Error("gone"));
    store.image("a");
    await flush();
    expect(store.image("a")).toBeUndefined();
    await flush();
    expect(api.loadStampImage).toHaveBeenCalledTimes(1);
  });

  it("does not load images of unknown ids", async () => {
    const { api, store } = setup();
    await store.init();
    expect(store.image("zzz")).toBeUndefined();
    await flush();
    expect(api.loadStampImage).not.toHaveBeenCalled();
  });

  it("importImage adds the new stamp to the list", async () => {
    const { api, store } = setup();
    await store.init();
    const m = await store.importImage("猫", "iVBOR", "ink");
    expect(api.importStamp).toHaveBeenCalledWith("猫", "iVBOR", "ink");
    expect(m.name).toBe("猫");
    expect(store.getSnapshot().stamps.map((s) => s.id)).toEqual(["a", "new"]);
  });

  it("importImage never lists the same id twice", async () => {
    const { api, store } = setup([meta("a")]);
    await store.init();
    api.importStamp.mockResolvedValueOnce(meta("a", { name: "再取り込み" }));
    await store.importImage("再取り込み", "b", "original");
    expect(store.getSnapshot().stamps).toEqual([meta("a", { name: "再取り込み" })]);
  });

  it("remove deletes the stamp and forgets its image", async () => {
    const { api, store } = setup();
    await store.init();
    store.image("a");
    await flush();
    await store.remove("a");
    expect(api.deleteStamp).toHaveBeenCalledWith("a");
    expect(store.getSnapshot().stamps).toEqual([]);
    expect(store.image("a")).toBeUndefined();
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const { store } = setup();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    await store.init();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    await store.importImage("x", "b", "original");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
