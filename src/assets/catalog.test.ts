import { describe, expect, it } from "vitest";
import { ASSETS, CATEGORIES, assetsIn, findAsset, type InkAsset } from "./catalog";

const ink = ASSETS.filter((a): a is InkAsset => a.category !== "phrase");
const names = (cat: string) => assetsIn(cat as never).map((a) => a.name).join(" ");

describe("asset catalog (A1)", () => {
  it("has unique ids", () => {
    const ids = ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has at least one asset in every category", () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(["animal", "item", "phrase"]);
    for (const c of CATEGORIES) {
      expect(c.label).not.toBe("");
      expect(assetsIn(c.id).length).toBeGreaterThan(0);
    }
  });

  it("covers the initial set: 3 animals x 2 poses, 3 modern items, 2 phrases", () => {
    for (const animal of ["カエル", "ウサギ", "猿"]) {
      expect(assetsIn("animal").filter((a) => a.name.startsWith(animal))).toHaveLength(2);
    }
    for (const item of ["ノートPC", "スマートフォン", "自転車"]) expect(names("item")).toContain(item);
    const texts = assetsIn("phrase").map((a) => (a.category === "phrase" ? a.text : ""));
    expect(texts).toEqual(expect.arrayContaining(["これはいかに", "おっとっと"]));
  });

  it("keeps every ink line inside the asset box with valid pressure", () => {
    for (const a of ink) {
      expect(a.lines.length).toBeGreaterThan(0);
      for (const line of a.lines) {
        expect(line.length).toBeGreaterThanOrEqual(2);
        for (const [x, y, p] of line) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(a.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(a.height);
          expect(p).toBeGreaterThan(0);
          expect(p).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("uses sane brush settings and names", () => {
    for (const a of ASSETS) {
      expect(a.name).not.toBe("");
      expect(a.width).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
    }
    for (const a of ink) {
      expect(a.brush.size).toBeGreaterThan(0);
      expect(a.brush.bleed).toBeGreaterThanOrEqual(0);
      expect(a.brush.dryness).toBeLessThanOrEqual(1);
    }
  });

  it("has a hidden custom-text bubble that the library does not list", () => {
    expect(findAsset("phrase-custom")).toMatchObject({ category: "phrase", hidden: true });
    expect(assetsIn("phrase").map((a) => a.id)).not.toContain("phrase-custom");
  });

  it("findAsset looks up by id", () => {
    expect(findAsset(ASSETS[0].id)).toBe(ASSETS[0]);
    expect(findAsset("no-such-asset")).toBeUndefined();
  });
});
