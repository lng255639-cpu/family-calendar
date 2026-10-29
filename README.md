# 家庭行事曆

全家共用的行事曆 App（PWA）。任何人新增事件，全家手機都看得到；時間到，每支手機都會跳通知。

- 前端：`public/`（Android Chrome「加到主畫面」後就像一般 App）
- 後端：`src/worker.js`，跑在 Cloudflare Workers（免費方案）
- 資料庫：Cloudflare D1（`schema.sql`）
- 每分鐘檢查一次到期事件，用 Web Push 發通知（推播不帶內容，手機收到後再來 `/api/feed` 取）

## 功能

- 月曆檢視，點日期看當天事情，下方列出接下來 60 天
- 新增 / 修改 / 刪除事件：日期、時間、備註
- 準時提醒，可以再加一次提前提醒（5 分鐘～1 天）
- 重複：每天 / 每週 / 每月 / 每年
- 家庭密碼：沒有密碼的人看不到也改不了
- 設定裡可以送測試通知給自己這支手機，看哪些家人已開通知

## 部署（一次就好）

1. 到 https://dash.cloudflare.com/sign-up 註冊免費帳號
2. 在這個資料夾執行：

```bash
npm install
npx wrangler login
npx wrangler d1 create family-calendar
```

3. 把上一步印出來的 `database_id` 貼到 `wrangler.jsonc`
4. 建資料表、產生推播金鑰：

```bash
npm run db:init
npm run keys
```

5. 把金鑰和家庭密碼設成機密值（每個指令會要你貼上值）：

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_JWK
npx wrangler secret put FAMILY_KEY
```

6. 上線：

```bash
npm run deploy
```

會得到網址，例如 `https://family-calendar.你的帳號.workers.dev`。

## 家人手機安裝（Android）

1. 用 **Chrome** 開上面的網址
2. 右上角 ⋮ →「加到主畫面」或「安裝應用程式」
3. 從主畫面打開「家庭行事曆」，輸入自己的名字和家庭密碼
4. 按「開啟通知」→ 允許
5. ⚙ 設定 →「送一則測試通知給這台手機」，確認會跳

通知延遲或收不到時：手機「設定 → 應用程式 → Chrome → 電池」改成「不受限制」。

## 本機開發

```bash
npm run db:init:local
npm run dev
```

`.dev.vars` 放本機用的 `FAMILY_KEY`、`VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_JWK`。
Windows 路徑太長時 D1 會出現 `SQLITE_CANTOPEN`，加 `--persist-to C:/某個短路徑` 解決。
