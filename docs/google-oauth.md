# Google 登入金鑰設定

Google 登入（#124）需要兩個值：

| 名稱                   | 類型         | 是否機密                 | 說明                                                  |
| ---------------------- | ------------ | ------------------------ | ----------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | text binding | 否（會出現在登入網址上） | OAuth 用戶端 ID，結尾是 `.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | secret       | **是**                   | OAuth 用戶端密鑰，開頭是 `GOCSPX-`                    |

任一值留空時，Google 登入會停用：按下 Google 登入會導回 `/login?error=oauth_unavailable`，其他功能不受影響。

另外會用到 `PUBLIC_BASE_URL`，它決定 Google 登入完成後要導回哪個網址：`<PUBLIC_BASE_URL>/api/auth/oauth/google/callback`。這個網址必須和 Google Console 裡登錄的 redirect URI **一字不差**。

## 1. 建立 OAuth 用戶端

1. 開啟 [Google Cloud Console](https://console.cloud.google.com/)，選擇或建立專案。
2. 進入 **Google Auth Platform**（舊版介面叫「API 和服務 → OAuth 同意畫面」），完成品牌設定：
   - 應用程式名稱、支援信箱
   - 目標對象選 **外部**
3. 到 **Clients（用戶端）→ 建立用戶端**：
   - 應用程式類型：**網頁應用程式**
   - 已授權的重新導向 URI：
     - 本機：`http://localhost:5173/api/auth/oauth/google/callback`
     - 正式站：`https://<正式網域>/api/auth/oauth/google/callback`
4. 建立後馬上複製 Client ID 和 Client secret。新版 Console **只在建立當下顯示一次 secret**，之後就看不到了。

> 測試中的應用程式只有「測試使用者」名單裡的帳號能登入，上限 100 人。要開放所有人使用，必須在 Google Auth Platform 把應用程式「發布為正式版」，而且要先提供隱私權政策網址。

## 2. 本機開發

在 `apps/web/.env.local` 填入以下內容（這個檔案已在 gitignore 中，不會進版控）：

```dotenv
PUBLIC_BASE_URL=http://localhost:5173
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
```

存檔後重開 `pnpm dev`，到 `http://localhost:5173/login` 按「使用 Google 帳號登入」測試。

## 3. 正式環境

- **`GOOGLE_CLIENT_SECRET`**：和其他 secrets 一樣，寫進 `apps/web/.env.production.local`，部署時用 `--secrets-file` 上傳（見 [`cf.md`](./cf.md#secrets)）。
- **`GOOGLE_CLIENT_ID`**：這是 text binding。正式環境不會讀 `.env*`，會直接用 `apps/web/cloudflare.config.ts` 裡的預設值，目前是空字串。上線時要把預設值改成正式的 Client ID 再 commit。Client ID 本來就是公開的，可以放進版控。
- **`PUBLIC_BASE_URL`**：預設是正式網域，要確認和 Google Console 登錄的 redirect URI 一致。

## 4. 更換（輪替）Client secret

secret 外洩（例如出現在截圖或訊息裡），或定期更換時，照下面步驟做：

1. Google Auth Platform → Clients → 點進該用戶端 → **Add secret（新增密鑰）**，複製新的 secret。這時新舊兩組同時有效，服務不會中斷。
2. 更新所有用到的地方：
   - 本機：`apps/web/.env.local` 的 `GOOGLE_CLIENT_SECRET`，改完重開 `pnpm dev`
   - 正式：`.env.production.local` 的 `GOOGLE_CLIENT_SECRET`，再用 `--secrets-file` 重新部署
3. 用新 secret 實際登入一次，確認成功。
4. 回到 Console，把舊 secret **停用（Disable）**，確認登入仍正常後再**刪除**。

只換 secret 不需要改 Client ID，也不影響已建立的帳號：帳號綁定的是 Google 使用者 ID，跟 secret 無關。

## 5. 更換整個 OAuth 用戶端（Client ID 也換）

例如從個人測試用的 Google 帳號，移交到團隊共用的專案時：

1. 在新專案依照第 1 節建立用戶端，redirect URI 要相同。
2. 同時更新 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`（本機的 `.env.local`，正式環境的 config 預設值和 secrets 檔）。
3. 已經用 Google 登入過的帳號不受影響：同一個 Google 帳號在不同 Client 拿到的使用者 ID（`sub`）相同。
4. 確認新用戶端可以登入後，刪除舊用戶端。

## 常見錯誤

| 現象                                          | 原因                                                                    | 處理                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/login?error=oauth_unavailable`              | `GOOGLE_CLIENT_ID` 或 `GOOGLE_CLIENT_SECRET` 沒設                       | 補上後重開 dev 或重新部署                                          |
| Google 頁面顯示 `redirect_uri_mismatch`       | `PUBLIC_BASE_URL` 和 Console 登錄的 URI 不一致，或 Console 設定還沒生效 | 檢查協定、網域、port、路徑是否完全一致；剛改完可能要等幾分鐘才生效 |
| `/login?error=oauth_failed`                   | secret 錯誤或已停用、使用者在 Google 頁面取消，或驗證失敗               | 確認 secret 是最新的一組；看伺服器 log                             |
| `/login?error=oauth_state_invalid`            | 登入請求超過 10 分鐘，或 cookie 遺失                                    | 重新按一次 Google 登入                                             |
| `/login?error=oauth_email_unverified`         | 這個 Google 帳號的信箱還沒驗證                                          | 請使用者先到 Google 驗證信箱                                       |
| Google 顯示「存取遭拒／應用程式尚未經過驗證」 | 應用程式還在測試模式，而且帳號不在測試使用者名單裡                      | 把帳號加進測試使用者，或發布為正式版                               |
