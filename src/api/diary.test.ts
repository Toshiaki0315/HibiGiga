import { describe, expect, it, vi } from "vitest";
import { mockIPC } from "@tauri-apps/api/mocks";
import {
  DiaryError,
  convertKofu,
  errorMessage,
  formatDate,
  isValidDate,
  listDiaryDates,
  loadDiary,
  saveDiary,
  type DiaryEntry,
} from "./diary";

const sample: DiaryEntry = {
  date: "2026-11-15",
  text: "今日も仕事が忙しかった",
  canvas: { stamps: [{ kind: "frog", x: 10, y: 20 }] },
};

/** 呼び出しを記録するIPCモックを仕込む */
function setupIPC(handler: (cmd: string, args: unknown) => unknown) {
  const spy = vi.fn(handler);
  mockIPC((cmd, args) => spy(cmd, args));
  return spy;
}

describe("isValidDate", () => {
  it.each(["2026-11-15", "2024-02-29", "1999-12-31"])("accepts %s", (d) => {
    expect(isValidDate(d)).toBe(true);
  });

  it.each([
    "",
    "2026-13-01",
    "2026-02-30",
    "2025-02-29",
    "2026-00-10",
    "2026-11-00",
    "2026-1-01",
    "20261115",
    " 2026-11-15",
    "../etc/passwd",
    "２０２６-11-15",
  ])("rejects %j", (d) => {
    expect(isValidDate(d)).toBe(false);
  });
});

describe("saveDiary", () => {
  // F1: save_diary が正しい引数で呼ばれる
  it("F1: invokes save_diary with the entry and returns the saved entry", async () => {
    const saved = { ...sample, updatedAt: "2026-11-15T21:00:00+09:00" };
    const spy = setupIPC(() => saved);

    await expect(saveDiary(sample)).resolves.toEqual(saved);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("save_diary", { entry: sample });
  });
});

describe("loadDiary", () => {
  // F2: 存在すれば型付きエントリ、無ければ null
  it("F2: returns the entry when it exists", async () => {
    const spy = setupIPC(() => sample);
    await expect(loadDiary("2026-11-15")).resolves.toEqual(sample);
    expect(spy).toHaveBeenCalledWith("load_diary", { date: "2026-11-15" });
  });

  it("F2: returns null when the diary does not exist", async () => {
    setupIPC(() => null);
    await expect(loadDiary("2026-01-01")).resolves.toBeNull();
  });
});

describe("listDiaryDates", () => {
  // F3: 日付配列を返す
  it("F3: returns dates from list_diary_dates", async () => {
    const spy = setupIPC(() => ["2025-01-01", "2026-11-15"]);
    await expect(listDiaryDates()).resolves.toEqual(["2025-01-01", "2026-11-15"]);
    expect(spy).toHaveBeenCalledWith("list_diary_dates", {});
  });
});

describe("backend errors", () => {
  // F4: バックエンドエラーは DiaryError(kind) として再throw
  it.each(["invalidDate", "corrupted", "io"] as const)(
    "F4: maps backend error kind %s to DiaryError",
    async (kind) => {
      setupIPC(() => {
        throw { kind, message: `backend ${kind}` };
      });
      const err = await loadDiary("2026-11-15").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DiaryError);
      expect(err).toMatchObject({ kind, message: `backend ${kind}` });
    },
  );

  it("F4: maps unknown error kinds to 'unknown'", async () => {
    setupIPC(() => {
      throw { kind: "somethingNew", message: "boom" };
    });
    await expect(listDiaryDates()).rejects.toMatchObject({ kind: "unknown", message: "boom" });
  });

  it("F4: wraps plain string errors as 'unknown'", async () => {
    setupIPC(() => {
      throw "command save_diary not found";
    });
    await expect(saveDiary(sample)).rejects.toMatchObject({
      name: "DiaryError",
      kind: "unknown",
      message: "command save_diary not found",
    });
  });

  it("F4: wraps Error instances as 'unknown'", async () => {
    setupIPC(() => {
      throw new Error("ipc down");
    });
    await expect(listDiaryDates()).rejects.toMatchObject({ kind: "unknown", message: "ipc down" });
  });

  it("F4: wraps non-object errors as 'unknown' with a stringified message", async () => {
    setupIPC(() => {
      throw 42;
    });
    await expect(listDiaryDates()).rejects.toMatchObject({ kind: "unknown", message: "42" });
  });
});

describe("client-side validation", () => {
  // F5: 不正な日付はIPCを呼ばずに失敗
  it("F5: saveDiary rejects invalid date without invoking IPC", async () => {
    const spy = setupIPC(() => sample);
    await expect(saveDiary({ ...sample, date: "2026-02-30" })).rejects.toMatchObject({
      kind: "invalidDate",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("F5: loadDiary rejects invalid date without invoking IPC", async () => {
    const spy = setupIPC(() => sample);
    await expect(loadDiary("../etc/passwd")).rejects.toBeInstanceOf(DiaryError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("formatDate", () => {
  it("formats a Date as local YYYY-MM-DD with zero padding", () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatDate(new Date(2026, 10, 15, 23, 59))).toBe("2026-11-15");
  });
});

describe("errorMessage", () => {
  it("uses Error.message and stringifies anything else", () => {
    expect(errorMessage(new DiaryError("io", "disk full"))).toBe("disk full");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("convertKofu (F-K1)", () => {
  it("invokes convert_kofu with the text and returns the result", async () => {
    const spy = setupIPC(() => "本日も一日疲弊せり。");
    await expect(convertKofu("今日も1日疲れた。")).resolves.toBe("本日も一日疲弊せり。");
    expect(spy).toHaveBeenCalledWith("convert_kofu", { text: "今日も1日疲れた。" });
  });

  it("wraps failures as DiaryError", async () => {
    setupIPC(() => {
      throw "command convert_kofu not found";
    });
    await expect(convertKofu("x")).rejects.toMatchObject({ name: "DiaryError", kind: "unknown" });
  });
});
