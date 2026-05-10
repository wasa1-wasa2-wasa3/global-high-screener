# CLAUDE.md — global-high-screener

## プロジェクト概要

米国株（Nasdaq / NYSE）に特化した52週高値スクリーナーツール。

- **USスキャン** (`/`): Nasdaq/NYSEの主要銘柄（約200社）の中で52週高値圏（95%以内）の銘柄を抽出
- ウォッチリスト機能: ★で保存、Supabase でPC・スマホ間同期
- シグナル自動判定: 🔴Breakout / 🔵押し目 / ⏳決算近 / ✨高配当 / ⚠️過熱(Stay)
- USD/JPY リアルタイム換算表示

## 技術スタック

| 項目 | 内容 |
|------|------|
| フレームワーク | Next.js 14.2.3 (App Router) |
| 言語 | JavaScript (JSX) — TypeScript 未導入 |
| パッケージマネージャー | npm |
| 認証・DB | Supabase (Magic Link 認証、Row Level Security) |
| データソース | Yahoo Finance API (v7/quote crumb必須, v8/chart for FX) |
| スタイル | インラインスタイルのみ（CSS ファイル・CSS Modules なし） |

## テーマカラー

- Navy: `#0A1628` / `#1E3A5F`
- Gold: `#C9A84C` / `#F0C040`

## パラメータ（日本株版との違い）

- 損切りデフォルト: **-10%**（日本版 -8%）
- 利確（元本回収）デフォルト: **+20%**（日本版 +15%）
- 52週高値スキャン閾値: **95%以内**（95%ルール）
- 高配当シグナル閾値: **2.5%以上**（日本版 3.5%）
- FX換算: USDJPY=X（Yahoo Finance v8/chart）

## ファイル構成

```
src/
  app/
    page.jsx                      # USスキャン画面
    guide/page.jsx                # ガイドページ
    auth/callback/page.jsx        # Magic Link コールバック
    api/scan/route.js             # 52週高値スキャン API（v7/quote 一括）
    api/fx/route.js               # USD/JPY レート API（v8/chart）
    api/watchlist-refresh/route.js # ウォッチリスト更新 API
  lib/
    supabase.js
    scoring.js                    # calcScore（US株スコア）
    signals.js                    # getSignals（シグナル判定）
  components/
    AuthButton.jsx
  data/
    tickers.json                  # 米国主要銘柄約200社
```

## Yahoo Finance API 注意事項

- v7/quote: crumb必須。`getYahooCrumbWithRetry`（3回リトライ）で取得
- v8/chart: crumb不要。FX取得に使用
- US株はティッカーそのまま（`.T`サフィックス不要）
- `maxDuration = 60`（Vercel Pro: 60秒タイムアウト）

## デプロイ

- Vercel に自動デプロイ（`master` ブランチへの push）
- 必須環境変数:
  ```
  NEXT_PUBLIC_SUPABASE_URL=
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
  ```
