# Air Freight Internal Quotation System

供台灣航空貨運承攬公司在本機或私人 GitHub Codespaces 使用的內部報價 MVP。以客戶合約售價計算應收運費，另行輸入成本，保留合約版本與報價快照，並產生不含內部成本的客戶 PDF。

技術：Next.js、TypeScript、Tailwind CSS、Prisma 6.19、SQLite、Zod、Decimal.js、PDFKit、Vitest。Prisma 透過官方 `@prisma/adapter-libsql` 操作本機 SQLite 檔案；不需要 LibSQL/Turso 帳號、付費 API 或雲端資料庫；本機使用不需第三方帳號，Codespaces 使用你自己的 GitHub 帳號。

## Codespaces：在 GitHub 瀏覽器操作

不想在 Windows 安裝 Node.js，可在 [TEC GitHub 倉庫](https://github.com/waynehsu28/TEC) 選 **Code → Codespaces → Create codespace on main**。容器會自動安裝依賴、建立 SQLite 並啟動系統。等設定完成後，在底部 **Ports** 找到 **3000**，確認 **Visibility = Private**，再按 **Open in Browser**。

已存在的 Codespace 請先取得最新 `main`，再從命令面板執行 **Codespaces: Rebuild Container**。不要將連接埠改為 Public 或組織共享；私人預覽使用 GitHub 的身分驗證，本系統仍沒有自己的登入權限。詳細啟動、重啟、故障排除及資料備份方式見 [Codespaces 操作說明](docs/codespaces.md)。

Codespaces 有帳號額度及可能的使用費用，建立前請確認 GitHub 顯示的計費對象與額度。資料留在你自己的 Codespace，並不會隨 Git 推送或下載原始碼自動同步。

## GitHub 下載與自動測試

在 GitHub 倉庫頁面選擇 **Code → Download ZIP**，解壓後依 Windows 安裝步驟啟動。GitHub 上提供的是完整原始碼；不是免安裝的 Windows EXE。

`.github/workflows/ci.yml` 會在推送 `main`、Pull Request 或手動執行時，以 Node.js 24 安裝鎖定依賴、建立暫存 SQLite、執行測試、TypeScript 檢查及 production build。到倉庫的 **Actions → MVP tests and build** 查看各步驟結果。Workflow 僅作驗證，不會公開部署系統。

## Windows 安裝與啟動

建議使用 **Windows 10／11 x64 與 Node.js 24 LTS**。本機 SQLite 驅動由 npm 提供 Windows x64 套件；目前整合驗證執行於 Linux，Windows 實機仍須依下列步驟驗證。先安裝 Node.js，重新開啟 PowerShell，確認 `node --version` 與 `npm --version` 可執行。將完整專案下載或複製到自己的資料夾，再執行：

```powershell
cd C:\Projects\TEC
npm ci --ignore-scripts
Copy-Item .env.example .env
npm run db:setup
npm run dev
```

`npm ci` 依提交的 `package-lock.json` 安裝固定依賴。若正在開發並需更新 lockfile，可改用 `npm install --ignore-scripts`。這裡先略過安裝生命週期指令，再由 `db:setup` 明確產生 Prisma Client 與資料庫，無需下載獨立 Prisma 原生引擎。

若已有 `.env`，保留原檔，不要覆蓋。預設內容為：

```dotenv
DATABASE_URL="file:./dev.db"
```

專案的資料庫路徑設定將此相對 URL 解析至 `prisma/dev.db`，CLI 與應用程式使用同一檔案。`db:setup` 會產生 Prisma Client 並套用已提交的 migrations，不會插入範例客戶或運價。既有資料庫請先備份再更新。

Prisma Client 使用 `engineType = "client"`，這是官方已正式提供的 JavaScript client engine。migration CLI 透過 `prisma.config.ts` 的 `engine: "js"` 與 adapter 執行；**Prisma 6.19 的這項 migration adapter 介面仍屬 experimental**。本專案固定相關版本並驗證 migration 可重跑；升級 Prisma 或更換驅動前，須先在資料庫副本測試。這項選擇不會關閉 TLS 或套件驗證。

在同一部電腦的瀏覽器開啟 `http://127.0.0.1:3000`。開發伺服器第一次編譯可能需要稍候；在 PowerShell 按 `Ctrl+C` 可停止。若 PowerShell 阻擋 `npm.ps1`，可使用 `npm.cmd` 代替 `npm`，不必修改系統執行原則。

需要固定的 production build 時：

```powershell
npm run build
npm start
```

`dev` 與 `start` 均綁定 `127.0.0.1`，Codespaces 也經由 GitHub 私人連接埠轉送存取，不必改綁 `0.0.0.0`。第一版沒有正式身分驗證、使用者權限或公開網路部署設定，僅限本機或私人 Codespaces 使用；不要自行公開轉發連接埠或部署到網際網路。

## 日常操作

1. **Settings／系統設定**：填入公司名稱、PNG/JPEG Logo（最多 1 MiB）、材積除數、計費重量進位單位及預設幣別。匯率方向固定為「1 USD = 幾 TWD」，並填使用日期。報價條款預設留白，由公司自行輸入。
2. **Customer Management／客戶管理**：新增客戶與唯一客戶代碼，填聯絡資料及預設幣別；可搜尋、編輯、停用。停用後仍保留既有資料及歷史報價。
3. **Customer Contract Rate Management／合約運價**：選客戶，輸入合約編號、航線、有效期間、幣別及運價。Normal Rate 與 +45／+100／+300 等級距可選填，亦可新增自訂級距；MIN 是整票基本運費下限。依實際合約逐項建立附加費，明確標記已含費用。編輯儲存會新增版本，舊版本保留。同一客戶可用相同合約編號維護不同航線／條件；完全相同的客戶、編號及航線條件不能重複建檔。複製／新增航線後請檢查客戶、合約編號與航線；表單預設清空編號，可自行填回相同編號並改用不同航線。
4. **New Quotation／新增報價**：選客戶、航線、出貨日及必要匹配條件；逐組輸入尺寸、件數及重量，明確選擇單件重量或整組總重量。取得候選合約並確認版本；多份候選時須選擇。沒有有效合約時，才輸入非合約售價。
5. 輸入費用調整、臨時費用及成本。成本可區分 Estimated／Actual；只有完整確認的成本才可視為完整毛利。先預覽計算結果，檢查幣別、匯率日期、成本警示、報價效期及條款，再選狀態儲存。
6. **Quotation History／歷史報價**：搜尋、檢視已保存快照及下載正式 PDF。需要修改時，以原報價建立修訂版本，再重新檢查當下可用合約；原報價不覆寫。
7. **Dashboard**：查看目前客戶、合約及報價摘要。初次使用的空白清單代表尚未建檔，系統不會以假資料代替。

完整計價判定見 [商業規則](docs/business-rules.md)，驗收方式與測試結果見 [驗收紀錄](docs/acceptance.md)。

## 資料與歷史紀錄

- 所有貨物尺寸使用 cm，重量使用 KG，金額支援 USD／TWD。
- 金額、運價及匯率以十進位字串保存，財務運算使用 Decimal.js。
- 合約更新建立新版本；新報價在每條合約航線中採用「有效期間涵蓋出貨日的最高版本」；尚未生效的未來版本不會提前停用仍適用的舊版本。舊報價保留建立時的完整快照。
- 快照包含客戶、公司名稱與 Logo、合約版本、貨物、費用、成本、匯率及報價條件。後續設定或合約更動不會重算舊報價。
- 報價單號採 `AFQ-YYYYMMDD-0001` 類型的台北日期每日流水號；後續修訂加上 `-R002` 等尾碼，以新紀錄保存並保留來源關係。
- PDF 只輸出客戶可見欄位，不含買價、內部成本、毛利、毛利率或 Markup。PDF 的使用者自填條款與備註仍應由輸入者確認內容。
- PDF 使用隨專案提供的繁體中文字型；字型授權見 `public/fonts/LICENSE.txt`，無需 Windows 額外安裝字型。

## 自動化檢查

```powershell
npm test
npm run typecheck
npm run build
```

測試使用獨立測試資料，不應用真實客戶或真實運價進行驗證。SQLite 的正式操作前請先備份。Linux 雲端環境的通過紀錄不等同於已在你的 Windows 電腦驗證；安裝後仍應執行上述命令並完成一次完整報價流程。

## SQLite 備份與還原

資料庫包含客戶、合約、報價、匯率，以及上傳 Logo 與歷史快照。程式原始碼、`.env` 和字型也請另外保留；它們不包含在單一資料庫備份內。

### 備份

先在執行伺服器的視窗按 `Ctrl+C`，確認所有使用這份資料庫的 Node.js 程序均已停止。在專案根目錄執行：

```powershell
$backupDir = Join-Path $env:USERPROFILE 'TEC-Backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item '.\prisma\dev.db' (Join-Path $backupDir "TEC-$stamp.db") -ErrorAction Stop
```

備份應放在專案目錄以外，並定期複製到另一個可靠儲存裝置。若改過 `DATABASE_URL`，請備份實際資料庫路徑。不要在程式仍寫入 SQLite 時直接複製單一 `.db` 檔；若看到 `.db-wal`／`.db-shm` 等伴隨檔，先確認寫入程序確實停止，再進行一致性的備份。

### 還原

1. 停止所有使用該資料庫的伺服器與工具。
2. 依上面的步驟先備份目前資料庫，避免覆蓋後無法回復。
3. 選定要還原的備份，在 PowerShell 執行下例，將檔名替換成自己的備份：

```powershell
Copy-Item "$env:USERPROFILE\TEC-Backups\TEC-20261105-120000.db" '.\prisma\dev.db' -ErrorAction Stop
npm run db:setup
npm run dev
```

4. 開啟客戶、合約及歷史報價，確認預期紀錄和 PDF 均可讀取。若無法讀取，停止服務，保留原備份與錯誤訊息，不要使用 reset 或刪除資料庫來處理真實資料。

若存在仍在使用或未完成檢查點的 WAL／SHM 伴隨檔，先處理一致性問題再還原；不要混用不同備份的主檔與伴隨檔。

## 第一版範圍

第一版涵蓋客戶、合約版本、貨物重量、合約匹配、費用調整、手動成本、毛利分析、報價歷史與客戶 PDF；實際驗證結果列在 [驗收紀錄](docs/acceptance.md)。

未納入：正式登入與權限、客戶入口網站、航空公司即時 API、自動成本運價庫、自動匯率、Weight Break Optimization、批次 Excel 匯入匯出、多使用者併發協作、公開網路部署、會計入帳與稅額計算。這些項目不會以靜態按鈕或測試價格冒充已完成功能。
