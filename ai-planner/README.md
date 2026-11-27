# 推薦頁的站方 AI

推薦頁繼續由 GitHub Pages 提供。訪客在結果頁按下生成後，才會將已提交的目標、語言、難度、格式及最多三個資源標題送到 `/plan`。Worker 使用站方帳戶呼叫模型，回傳第一週學習安排。

## 啟用

1. 在 `ai-planner` 目錄以 Node 22 或以上版本執行 `npm ci` 和 `npm test`。
2. 以站方 Cloudflare 帳戶執行 `npx wrangler login`。確認 `wrangler.jsonc` 的 `SITE_ORIGIN` 與正式網站相符。
3. 預設使用 Workers AI 綁定和 `MODEL` 指定的模型，使用站方 Cloudflare 帳戶額度。若要使用自己的 Gemini 金鑰，將 `MODEL` 改為該金鑰可用的 Gemini 模型 ID，執行 `npx wrangler secret put GEMINI_API_KEY` 並在隱藏輸入提示貼上金鑰。
4. 執行 `npm run deploy`。從輸出取得 Worker HTTPS 網址，在網址末尾加上 `/plan`。
5. 將完整端點設為 GitHub Repository Actions **variable** `NEXT_PUBLIC_AI_PLANNER_URL`，重新執行 `Deploy to GitHub Pages`。只有這個公開端點需要進入前端。移除變數並重新建置即可隱藏站方入口。如需停止模型呼叫，也要停用 Worker。

## 次數與重設

每天以 UTC 零點為界。每個 Cloudflare 辨識的來源 IP 共用 10 次，Durable Object 會在呼叫模型前以原子操作取得一次額度。無效的請求和本地推薦都不扣次。已送給模型的呼叫會計次，包括供應商失敗的呼叫。用完後 API 回傳 HTTP 429、剩餘次數、重設時間與 `Retry-After`，前端依訪客當地時區顯示重設時間。

配額資料只記錄重設時間與使用次數，過期後由鬧鐘清理。模型輸入不含 IP，Worker 不保存目標或生成內容。
