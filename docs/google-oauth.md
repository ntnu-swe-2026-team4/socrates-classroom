# Google 登入金鑰設定

> 專案接線核對：2026-11-19，`integration/web-next-142`（PR #155，尚未合併）。Console 操作與專案設定分開敘述；目前 production 接線與 CD 修復由 [#167](https://github.com/ntnu-swe-2026-team4/socrates-classroom/issues/167) 追蹤，尚未完成。

Google 登入（#124）需要兩個值：

| 名稱                   | 類型         | 是否機密                 | 說明                                                  |
| ---------------------- | ------------ | ------------------------ | ----------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | text binding | 否（會出現在登入網址上） | OAuth 用戶端 ID，結尾是 `.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | secret       | **是**                   | OAuth 用戶端密鑰，開頭是 `GOCSPX-`                    |

**Runtime 行為**：任一值留空時，`GET /api/auth/providers` 回 `{google: false}`，登入頁 Google 按鈕停用；直接存取 OAuth start 會導回 `/login?error=oauth_unavailable`。**部署限制**：目前 production config 無條件要求 `GOOGLE_CLIENT_SECRET`，即使 client ID 為空也會阻擋缺 secret 的 deploy；「Google 選用且不影響其他功能」尚未在部署設定落實（#167）。

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

### 目前接線

- **`GOOGLE_CLIENT_SECRET`**：production 為無條件 `bindings.secret()`。CI 從 repo secret `PROD_SECRETS_FILE` 產生暫存 dotenv，再以 `--secrets-file` 傳入；本機 development 才讀 `.env.local` 的 optional text。
- **`GOOGLE_CLIENT_ID`**：text binding。production 的 config 不讀 `.env*`，`text()` helper 也未讀 `process.env`，所以目前取 code 裡的空字串預設。單獨新增 GitHub Actions variable **尚不會生效**；`deploy.yml` 的 build step 亦未注入該 variable。
- **`PUBLIC_BASE_URL`**：config 預設為 `https://socrates.g36maid.dev`，callback 為 `https://socrates.g36maid.dev/api/auth/oauth/google/callback`。

### #167 待完成的接線與驗收

- 將 public client ID 的來源接通 config 與 CI build；issue 提議由 GitHub Actions variable 提供，但現在不能當作已實作。
- 對齊選用設計：client ID 為空時不要求 Google secret；非空時驗證 secret。不要只填假 secret 讓 deploy 通過。
- 由 maintainer 建立 OAuth client、登記 callback，將真實 secret 放入 `PROD_SECRETS_FILE`；只經 CI 部署。
- 驗證未啟用 Google 時仍能部署；啟用後 `{google: true}` 且可完成一次登入。

Deploy workflow 與 migration 風險只記於 [`cf.md` §CI/CD](./cf.md#cicd)。本文件更新沒有修改 bindings，也沒有代表 #167 已解凍。

## 4. 更換（輪替）Client secret

secret 外洩（例如出現在截圖或訊息裡），或定期更換時，照下面步驟做：

1. Google Auth Platform → Clients → 點進該用戶端 → **Add secret（新增密鑰）**，複製新的 secret。這時新舊兩組同時有效，服務不會中斷。
2. 更新所有用到的地方：
   - 本機：`apps/web/.env.local` 的 `GOOGLE_CLIENT_SECRET`，改完重開 `pnpm dev`
   - 正式：repo secret `PROD_SECRETS_FILE` 內的 `GOOGLE_CLIENT_SECRET`，再走 CI 部署；不要手動 deploy
3. 用新 secret 實際登入一次，確認成功。
4. 回到 Console，把舊 secret **停用（Disable）**，確認登入仍正常後再**刪除**。

只換 secret 不需要改 Client ID，也不影響已建立的帳號：帳號綁定的是 Google 使用者 ID，跟 secret 無關。

## 5. 更換整個 OAuth 用戶端（Client ID 也換）

例如從個人測試用的 Google 帳號，移交到團隊共用的專案時：

1. 在新專案依照第 1 節建立用戶端，redirect URI 要相同。
2. 同時更新 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`（本機的 `.env.local`；正式環境依 [§3](#3-正式環境) 完成的 config／CI 接線與 repo secret），由 CI 上線。
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
