import { describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import { StampError, deleteStamp, importStamp, listStamps, loadStampImage, type StampMeta } from "./stamps";

const meta: StampMeta = {
  id: "6a2f41a3-c54c-4ce8-a2d2-0324e1c32e22",
  name: "猫",
  width: 640,
  height: 480,
  style: "ink",
  createdAt: "2026-11-15T21:00:00+09:00",
};

function setupIPC(handler: (cmd: string, args: unknown) => unknown) {
  const spy = vi.fn(handler);
  mockIPC((cmd, args) => spy(cmd, args));
  return spy;
}

describe("stamp API (I1)", () => {
  it("importStamp sends name, base64 PNG and style", async () => {
    const spy = setupIPC(() => meta);
    await expect(importStamp("猫", "iVBOR", "ink")).resolves.toEqual(meta);
    expect(spy).toHaveBeenCalledWith("import_stamp", { name: "猫", pngBase64: "iVBOR", style: "ink" });
  });

  it("listStamps / loadStampImage / deleteStamp call their commands", async () => {
    const spy = setupIPC((cmd) => (cmd === "list_stamps" ? [meta] : cmd === "load_stamp_image" ? "iVBOR" : null));
    await expect(listStamps()).resolves.toEqual([meta]);
    await expect(loadStampImage(meta.id)).resolves.toBe("iVBOR");
    await expect(deleteStamp(meta.id)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith("list_stamps", {});
    expect(spy).toHaveBeenCalledWith("load_stamp_image", { id: meta.id });
    expect(spy).toHaveBeenCalledWith("delete_stamp", { id: meta.id });
  });

  it.each(["invalidId", "invalidName", "invalidImage", "tooLarge", "notFound", "corrupted", "io"] as const)(
    "maps backend error kind %s to StampError",
    async (kind) => {
      setupIPC(() => {
        throw { kind, message: `m-${kind}` };
      });
      const err = await listStamps().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StampError);
      expect(err).toMatchObject({ name: "StampError", kind, message: `m-${kind}` });
    },
  );

  it("maps anything else to 'unknown'", async () => {
    setupIPC(() => {
      throw "boom";
    });
    await expect(deleteStamp("x")).rejects.toMatchObject({ kind: "unknown", message: "boom" });
  });
});
