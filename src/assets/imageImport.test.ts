import { describe, expect, it, vi } from "vitest";
import {
  ACCEPTED_TYPES,
  ImageImportError,
  MAX_IMPORT_EDGE,
  defaultStampName,
  fitSize,
  prepareImage,
  type ImageCodec,
} from "./imageImport";

describe("fitSize (I2)", () => {
  it("shrinks the longer edge to the maximum keeping the aspect ratio", () => {
    expect(MAX_IMPORT_EDGE).toBe(1024);
    expect(fitSize(4032, 3024)).toEqual({ w: 1024, h: 768 });
    expect(fitSize(1000, 3000)).toEqual({ w: 341, h: 1024 });
  });

  it("never enlarges small images and keeps at least 1px", () => {
    expect(fitSize(300, 200)).toEqual({ w: 300, h: 200 });
    expect(fitSize(100000, 1)).toEqual({ w: 1024, h: 1 });
  });
});

describe("defaultStampName (I2)", () => {
  it("drops the extension and trims to 40 characters", () => {
    expect(defaultStampName("IMG_0001.HEIC.jpg")).toBe("IMG_0001.HEIC");
    expect(defaultStampName("猫.png")).toBe("猫");
    expect(defaultStampName(`${"あ".repeat(50)}.png`)).toBe("あ".repeat(40));
    expect(defaultStampName(".png")).toBe("スタンプ");
  });
});

describe("prepareImage (I2)", () => {
  const codec = (): ImageCodec & { decode: ReturnType<typeof vi.fn>; encodePng: ReturnType<typeof vi.fn> } => ({
    decode: vi.fn(async () => ({ width: 4032, height: 3024, source: "SRC" as unknown as CanvasImageSource })),
    encodePng: vi.fn(async () => "iVBORbase64"),
  });

  it("decodes, downsizes and re-encodes as PNG (dropping EXIF metadata)", async () => {
    const c = codec();
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    await expect(prepareImage(file, c)).resolves.toEqual({ pngBase64: "iVBORbase64", width: 1024, height: 768 });
    expect(c.decode).toHaveBeenCalledWith(file);
    expect(c.encodePng).toHaveBeenCalledWith("SRC", 1024, 768);
  });

  it("accepts PNG, JPEG and WebP only", async () => {
    expect(ACCEPTED_TYPES).toEqual(["image/png", "image/jpeg", "image/webp"]);
    const c = codec();
    for (const type of ["image/svg+xml", "image/gif", ""]) {
      await expect(prepareImage(new File(["x"], "a", { type }), c)).rejects.toBeInstanceOf(ImageImportError);
    }
    expect(c.decode).not.toHaveBeenCalled();
  });

  it("wraps decoding failures", async () => {
    const c = codec();
    c.decode.mockRejectedValueOnce(new Error("corrupt"));
    await expect(prepareImage(new File(["x"], "a.png", { type: "image/png" }), c)).rejects.toThrow(
      /画像を読み込めませぬ/,
    );
  });
});
