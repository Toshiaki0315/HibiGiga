# 日々戯画 (HibiGiga) の開発・ビルド用コマンド
#
#   make dev   開発モードで起動 (ホットリロード)
#   make app   macOS 用の .app をビルド
#   make dmg   macOS 用の .dmg (インストーラー) をビルド

BUNDLE_DIR := src-tauri/target/release/bundle

.PHONY: dev app dmg

# 依存パッケージが未インストール、または package.json / ロックファイルが更新されたら入れ直す
node_modules: package.json pnpm-lock.yaml
	pnpm install --frozen-lockfile
	@touch node_modules

dev: node_modules
	pnpm tauri dev

app: node_modules
	pnpm tauri build --bundles app
	@echo "→ $(BUNDLE_DIR)/macos/"
	@ls -d $(BUNDLE_DIR)/macos/*.app

# .dmg だけを指定すると途中で作った .app が片付けられるため、.app も一緒に残す
dmg: node_modules
	pnpm tauri build --bundles app,dmg
	@echo "→ $(BUNDLE_DIR)/dmg/"
	@ls $(BUNDLE_DIR)/dmg/*.dmg
