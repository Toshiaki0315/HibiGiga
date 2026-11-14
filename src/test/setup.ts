import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { setUserAssetResolver } from "../emaki/stampRender";

// 各テスト後にTauri IPCモックをリセットする
afterEach(() => {
  clearMocks();
  localStorage.clear();
  setUserAssetResolver(null);
});

import { installFakeCanvas } from "./fakeCanvas";
installFakeCanvas();
