# 推薦頁的站方 AI

訪客輸入學習目標、程度、語言與資源類型後，可直接取得 AI 推薦。Worker 會快取並讀取站方 `/data/recommendations.json` 目錄（非本機環境於 isolate 內快取 10 分鐘）。模型先產生中英雙語搜尋詞，後端以 BM25 演算法篩選並檢索全目錄，最多提供 60 筆候選的標題、來源網域、分類、標籤、簡介及可用的難度資料。模型自行排序，選擇最多三筆學習資料。啟用 GitHub 專案推薦時，60 筆候選之中最多保留 18 個站方收藏專案，依能力標籤、技術棧、`whySaved`、`bestFor` 和摘要檢索，排除已知封存或無法使用的項目。模型可另選最多兩個專案，附上參考或應用理由及第一步。語言和類型篩選用於學習資料。後端核對每個選中 ID，遇到暫時性上游錯誤或包裹格式 JSON 時自動重試一次，前端連回目錄詳情頁與原站。搜尋和選擇兩個模型步驟合計為一次使用者推薦額度。

## 啟用

1. 在 `ai-planner` 目錄以 Node 22 或以上版本執行 `npm ci` 和 `npm test`。
2. 在此目錄的 `.env` 填入 `AI_API_URL`、`AI_API_KEY` 和 `AI_MODEL`。新工作目錄可從 `.env.example` 複製。網址可填以版本號結尾的 HTTPS API 網址（例如 `https://api.example.com/v1`），或完整的 Chat Completions 端點，金鑰填原值，模型填供應商的模型 ID。後端使用 Bearer 驗證和 OpenAI 相容的 Chat Completions 格式。
3. 以站方 Cloudflare 帳戶執行 `npx wrangler login`。確認 `wrangler.jsonc` 的 `SITE_ORIGIN` 與正式網站相符，然後執行 `npm run deploy`。從輸出取得 Worker HTTPS 網址，在網址末尾加上 `/plan`。
4. 三個欄位填妥後，在此目錄執行 `npx wrangler secret bulk .env`，把設定同步為正式 Worker 的 secrets。日後更換供應商或輪替金鑰時，更新 `.env` 後再同步即可。
5. 將完整端點設為 GitHub Repository Actions **variable** `NEXT_PUBLIC_AI_PLANNER_URL`，重新執行 `Deploy to GitHub Pages`。只有這個公開端點需要進入前端。移除變數並重新建置即可隱藏站方入口。如需停止模型呼叫，也要停用 Worker。

## 次數與重設

每天以 UTC 零點為界。每個 Cloudflare 辨識的來源 IP 共用 10 次，Durable Object 會在呼叫模型前以原子操作取得一次額度。無效的請求和本地推薦都不扣次。已送給模型的呼叫會計次，包括供應商失敗的呼叫。用完後 API 回傳 HTTP 429、剩餘次數、重設時間與 `Retry-After`，前端依訪客當地時區顯示重設時間。

配額資料只記錄重設時間與使用次數，過期後由鬧鐘清理。模型輸入不含 IP，Worker 不保存目標或生成內容。
