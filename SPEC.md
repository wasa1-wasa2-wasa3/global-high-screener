# Global High Screener — 仕様書

> 最終更新: 2026-05-17

---

## 1. プロジェクト概要

Nasdaq / NYSE 上場の米国株を対象に、**52週高値圏のマルチバガー候補**を自動抽出するスクリーナーツール。

### 運用フロー（3ステップ）

```
STEP ① スキャン  →  STEP ② ウォッチリスト  →  STEP ③ ポートフォリオ
  候補を発見         発火を待つ                   損益・アクションを管理
```

---

## 2. 技術スタック

| 項目 | 内容 |
|------|------|
| フレームワーク | Next.js 14.2.3 (App Router) |
| 言語 | JavaScript (JSX) — TypeScript 未導入 |
| パッケージマネージャー | npm |
| 認証・DB | Supabase (Magic Link 認証、Row Level Security) |
| データソース | Yahoo Finance API (v7/quote, v8/chart, v10/quoteSummary, screener) |
| AI 解析 | Google Gemini API (`@google/generative-ai`) |
| スタイル | インラインスタイルのみ（CSS ファイル・CSS Modules なし） |
| デプロイ | Vercel（`master` ブランチ push で自動デプロイ） |

### テーマカラー

- Navy: `#0A1628` / `#1E3A5F`
- Gold: `#C9A84C` / `#F0C040`

---

## 3. ファイル構成

```
src/
  app/
    page.jsx                      # USスキャン・ウォッチリスト画面
    guide/page.jsx                # 初回ガイドページ（初回アクセス時にリダイレクト）
    portfolio/page.jsx            # ポートフォリオ管理画面
    auth/callback/page.jsx        # Magic Link コールバック
    api/
      scan/route.js               # 52週高値スキャン API（4フェーズ処理）
      watchlist-refresh/route.js  # ウォッチリスト価格更新 API
      fx/route.js                 # USD/JPY レート取得 API（v8/chart）
      gemini-enrich/route.js      # Gemini AI 銘柄解析 API
      fundamentals/route.js       # 詳細ファンダメンタルズ取得 API
  lib/
    scoring.js                    # calcScore（スコア計算）
    signals.js                    # getSignals（シグナル判定）
    trend-analyzer.js             # getTrendMode（トレンドランプ判定）
    supabase.js                   # Supabase クライアント
  components/
    AuthButton.jsx                # ログイン/ログアウトボタン
  data/
    tickers.json                  # 米国主要銘柄リスト（スクリーナー失敗時のフォールバック）
```

---

## 4. スキャン API（`/api/scan`）

### 処理フロー（4フェーズ）

#### Phase 1 — Yahoo Finance スクリーナーで上位 1,000 銘柄を動的取得
- `v1/finance/screener` に 4リクエスト並列（offset 0/250/500/750）= 最大 1,000 銘柄
- 条件: Nasdaq (NMS) または NYSE (NYQ)、時価総額 $1B 以上、時価総額降順
- スクリーナー失敗時は `tickers.json` の静的リストにフォールバック

#### Phase 2 — v7/quote バッチ取得（最大 6 並列 × 50 件）
- 50 件ずつバッチ分割、最大 6 バッチ並列で価格・ファンダデータを取得
- タイムアウト: 8 秒

#### ハードフィルタ①（フェーズ間処理）
| 条件 | 値 | 意図 |
|------|----|------|
| 52週高値比 | ≥ 95% | 高値圏のみ |
| 時価総額 下限 | ≥ $1B | マイクロキャップ除外 |
| 時価総額 上限 | ≤ $50B | 大型株除外（10倍余地なし） |
| PSR | ≤ 25 倍 | 投機バブル除外 |
| 日平均出来高 | ≥ 200,000 株 | 流動性確保 |
- 上位 50 件をスコア降順で残す

#### Phase 3 — ファンダメンタルズ補完（v10/quoteSummary）
- 上位 50 件の `revenueGrowthYoy` / `grossMargin` を並列取得（5 秒タイムアウト）
- 取得後にスコアを再計算

#### ハードフィルタ②
| 条件 | 値 |
|------|----|
| Rev YoY | ≥ +15%（または取得不能） |
| Gross Margin | ≥ 40%（または取得不能） |
- 最終 25 件を残す

#### Phase 4 — Island Reversal 検知
- 最終 25 件に対して v8/chart（直近 7 日 OHLC）を並列取得
- アイランド底確認時はスコア +5pt

### スキャン結果のキャッシュ
- `localStorage['us_scan_last_v1']` に `{ rows, scannedAt, scannedCount }` を保存
- ページリロード時に自動復元

---

## 5. スコアリング（`calcScore`）

### 加点ブラケット（合計 100pt 上限）

| # | 項目 | 最大 | 条件 |
|---|------|------|------|
| 1 | 売上成長率 YoY | 45pt | ≥50%→45、≥30%→30、≥20%→15、≥10%→6 |
| 2 | 小型株プレミアム | 25pt | ≤$2B→25、≤$5B→20、≤$10B→14、≤$50B→6 |
| 3 | グロス利益率 | 20pt | ≥70%→20、≥50%→10、≥30%→4 |
| 4 | 52週高値近接 | 10pt | ≥100%→10、≥99%→8、≥97%→5、≥95%→2 |
| 5 | PSR | 10pt | <5→10、<10→7、<20→4、<40→1 |
| 6 | 出来高急増 | 5pt | ≥4x→5、≥3x→3、≥2x→2、≥1.5x→1 |
| 7 | 前日モメンタム | 2pt | ≥+5%→2、≥+1%→1 |
| 8 | 成長効率ボーナス | 8pt | Rev≥30% かつ PSR<15 |

### ポスト補正（加点後に適用）

| ルール | 条件 | 処理 |
|--------|------|------|
| A | ≤$2B 超小型 | × 1.2 マルチプライヤー |
| B | Rev YoY > 50% | 最低 B ランク保証（score ≥ 63） |
| C | Rev≥20% かつ GM≥70% | 最低 B ランク保証（score ≥ 63） |
| G | <$10B かつ Rev>50% | 最低 A ランク保証（score ≥ 70） |
| D | $20B〜$50B | B 以下に制限（score ≤ 69） |
| E | >$50B | 強制 D（score ≤ 10） |

### スコアランク

| ランク | 範囲 | 意味 |
|--------|------|------|
| S | 80–100 | Strong Buy |
| A | 70–79 | Buy / Entry |
| B | 60–69 | Watch / Hold |
| C | 50–59 | Neutral |
| D | <50 | Ignore |

---

## 6. シグナル判定（`getSignals`）

| シグナル | 条件 |
|----------|------|
| 🔴 Breakout | 価格 ≥ 52W高値×99.9% かつ 出来高比 ≥ 1.5x かつ 前日比 > +0.5% |
| 🔵 押し目 | `lastNearHighAt` から 7 日以内 かつ 高値比 -10〜-2% |
| ⏳ 決算近 | 決算日まで 0〜7 日 |
| ⚠️ 過熱(Stay) | MA50乖離 > +30% |
| 💎 DEEP VALUE | PBR > 0 かつ PBR < 1.0 |
| 🏝️ アイランド底 | Gap Down → 孤立 → Gap Up のパターン検出 |

> ✨高配当シグナルは削除済み（US版では除外）

---

## 7. トレンドランプ（`getTrendMode`）

3 つのモードを判定し、表示コンテキストによってラベルを切り替える。

### 判定ロジック

| モード | 条件 |
|--------|------|
| `breakout` | 52W高値の 0.1% 以内 かつ 出来高比 ≥ 1.5x かつ 前日比 > +0.5% |
| `exit` | 出来高比 ≥ 2x かつ 前日比 ≤ -2% ／または MA50乖離 < -3% かつ 出来高比≥1.5x かつ 前日比<-1% |
| `holding` | 52W高値の 5% 以内 かつ 出来高比 ≤ 0.8x かつ 前日比 > -3% |
| `null` | 上記以外 |

### 表示コンテキスト（3 種）

| コンテキスト | breakout | holding | exit | null |
|--------------|----------|---------|------|------|
| **SCAN_CFG**（スキャン） | 急いで★追加！ | ★追加して待つ | 見送り推奨 | ★追加して待つ |
| **WATCH_CFG**（ウォッチ） | 今すぐエントリー | もう少し待て | ウォッチ外す候補 | 待機中 |
| **TREND_CFG**（ポートフォリオ） | 買い増し | 保有OK | 売り検討 | 様子見 |

---

## 8. スキャン画面（`/`）

### 表示項目（デスクトップ 12 列）

`ウォッチ / ティッカー / 価格(USD) / JPY換算 / 前日比 / 52W高値比 / 出来高比 / 時価総額 / Rev YoY / Gross Mg / シグナル / スコア`

### フィルタ

| フィルタ | 選択肢 |
|----------|--------|
| 規模 | すべて / Micro-Cap $1B–$2B (×1.2ボーナス) / Small-Cap $2B–$10B / Mid-Cap $10B–$50B |
| セクター | すべて / 各セクター（取得件数付き、最多セクターに🔥） |

### STEP インジケーター

```
[STEP ①] スキャン ◀ 現在地  →  [STEP ②] ウォッチ  →  [STEP ③] ポートフォリオ
```

### ウォッチリストタブ

- **自動リフレッシュ**: タブ切替時に前回更新から 1 時間以上経過していれば自動で価格更新
- **古いデータ警告**: 1 時間以上古い場合に黄色バナーを表示
- **最終更新時刻**表示（HH:MM）
- **手動更新ボタン**「🔄 価格を更新」

### 購入フロー（ウォッチリストタブ）

`trendMode === 'breakout'` の銘柄に「✅ 購入した」ボタンが表示。
クリックするとインライン入力フォームが展開：

```
平均取得単価 (USD): [____]  株数: [____]  [📊 ポートフォリオへ]  [キャンセル]
```

送信すると `us_portfolio_v1`（localStorage）に保存し、`/portfolio` へ遷移。

---

## 9. データ永続化

### localStorage キー

| キー | 内容 | 形式 |
|------|------|------|
| `us_scan_last_v1` | 最終スキャン結果 | `{ rows, scannedAt, scannedCount }` |
| `us_watchlist_v1` | ウォッチリスト | `{ [ticker]: rowData }` |
| `us_watch_refreshed_v1` | ウォッチリスト最終更新日時 | ISO 8601 文字列 |
| `us_portfolio_v1` | ポートフォリオ | `{ [ticker]: rowData }` |
| `us_filter_v2` | スキャンフィルタ設定 | `{ cap, sector }` |
| `guide_seen_us_v1` | ガイド閲覧フラグ | 任意値 |

### Supabase（ログイン時）

ウォッチリストはローカルのみ。ポートフォリオは Supabase に同期。

```sql
CREATE TABLE watchlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  list_type TEXT NOT NULL DEFAULT 'scan',
  ticker TEXT NOT NULL,
  name TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT watchlist_user_list_ticker UNIQUE (user_id, list_type, ticker)
);
```

| list_type | 用途 |
|-----------|------|
| `us_portfolio` | US株ポートフォリオ |

---

## 10. ポートフォリオ画面（`/portfolio`）

### 機能概要

- ティッカー手動追加 + 「🔄 価格更新」で一括取得
- 保有数量・取得単価をインラインで直接編集（onBlur 保存）
- 損切り価格 / 元本回収指値の自動計算・表示
- 恩株化（元本回収後のコストゼロ保有）管理
- 📋 発注コピーボタン（クリップボードへ）
- USD/JPY リアルタイム換算表示

### アクションバッジ（各行）

行の状態に応じて「恩株管理」列に 1 つのバッジを表示：

| バッジ | 条件 | 推奨アクション |
|--------|------|----------------|
| 🚨 損切り実行 | 損益% ≤ 損切りライン（デフォルト -10%） | 今すぐ損失確定 |
| 💡 半分売って元本回収 | 損益% ≥ 利確ライン（デフォルト +20%） | 取得総額分の株を売却し恩株化 |
| 🔥 買い増し | 出来高比 > 2x かつ 前日比 > +3% | ブレイクアウト中、ポジション拡大 |
| 💰 元本回収済・ガチホ | 恩株フラグ ON | コストゼロ、ひたすら保有 |
| 🟢 ガチホ継続 | 損益プラス（上記以外） | 保有継続、焦らず待つ |
| 🟡 調整中・様子見 | 損益マイナス（損切りライン未達） | トレンド監視 |

### Today's Action バナー

ポートフォリオ全体の中で該当する銘柄を **全件** ページ上部にバナー表示（1 銘柄 1 バナー、複数同時表示）。

### ブレイクアウトアラート

最新スキャン結果（`us_scan_last_v1`）から「出来高比 ≥ 3x かつ 52W高値比 ≥ -1% かつ前日比 > 0」の銘柄を検出してバナー表示。クリックでエントリーポップアップ。

### 恩株（おとこかぶ）

元本回収済み状態として管理。損切りラインが外れ、リスクフリーで保有継続。

---

## 11. Yahoo Finance API メモ

| API | crumb 要否 | 用途 |
|-----|-----------|------|
| `v1/finance/screener` | 要 | 上位 1,000 銘柄動的取得 |
| `v7/finance/quote` | 要 | 価格・財務データ一括取得 |
| `v8/finance/chart` | 不要 | OHLC・FXレート取得 |
| `v10/finance/quoteSummary` | 要 | Revenue Growth / Gross Margin |

- crumb 取得は `getYahooCrumbWithRetry`（3回リトライ、指数バックオフ）
- タイムアウト: 5〜12 秒（API 別に設定）
- `maxDuration = 60`（Vercel Pro 60 秒制限）
- 配当利回り 25% 超は特別配当フラグ（`specialDividend: true`）として除外表示

---

## 12. デプロイ

- Vercel に自動デプロイ（`master` ブランチへの push でトリガー）
- 必須環境変数（Vercel と `.env.local` の両方に設定）:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
GEMINI_API_KEY=
```

---

## 13. UI/UX ルール

- **モバイルファースト**: 375px で壊れないことを先に確認
- ヘッダーの flex レイアウトは `flexWrap: 'wrap'` + `rowGap` 必須
- テーブルは `overflowX: 'auto'` でスクロール対応
- アコーディオン（凡例等）は `<details>/<summary>` を使用（JS 不要）
- インラインスタイルの重複キー禁止

## 14. コード品質ルール

- コメントは WHY が非自明な場合のみ一行
- コンポーネントは 200 行以内を目標
- エラーハンドリングは API 境界（fetch / Supabase 呼び出し）のみ
- スタイルは CSS ファイル・CSS Modules なし、インラインのみ
