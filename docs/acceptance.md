# MVP 驗收紀錄

本文件區分已執行結果與可供重跑的驗收步驟。以下結果於 2026-11-05 在 Linux 雲端環境實際執行；未執行的平台另行標示。

## 實作範圍

以下是程式已提供的操作範圍；執行結果另列，不以功能清單代替驗證。

| 模組 | 已實作操作 |
| --- | --- |
| Dashboard | 真實資料摘要與模組入口 |
| Customer Management | 新增、編輯、搜尋、停用、關聯合約與歷史入口 |
| Customer Contract Rate Management | 航線與費用表格、自訂級距、版本保留、複製、新增航線、過期查詢、停用 |
| New Quotation | 多組貨物、重量計算、合約匹配與候選確認、費用調整、手動售價、成本與毛利預覽、交易保存 |
| Quotation History | 查詢、快照明細、建立修訂、客戶 PDF 下載 |
| Settings | 公司資訊、Logo、材積除數、進位單位、手動匯率與日期、自填條款 |

資料庫使用 Prisma 6.19 官方 LibSQL adapter 存取本機 SQLite。Client engine 已正式提供，migration CLI 的 JavaScript adapter 介面仍為 experimental；應固定依賴版本並在資料庫副本驗證升級。

## 自動化測試範圍

| 需求 | 檢查重點 |
| --- | --- |
| 1 計費重量 | 10 件、70 × 60 × 60 cm、單件 35 KG，實重 350、材積重 420、計費重 420 KG |
| 2 客戶合約價 | 420 KG 使用 +300 KG 的 USD 4.30/KG，基本運費 USD 1,806.00 |
| 3 毛利 | 收入 USD 1,806、成本 USD 1,344，毛利 USD 462、毛利率約 25.58% |
| 4 日期 | 有效起訖日包含當日，過期合約不能套用 |
| 5 客戶隔離 | Customer A 合約不能用於 Customer B |
| 6 已含費用 | All-in 已包含費用不重複加入應收 |
| 7 歷史快照 | 合約更新建立新版本，舊報價維持舊金額 |
| 8 缺成本 | 未知成本不當零成本，缺失／不完整／預估狀態可區分 |
| 9 PDF 隔離 | 對外欄位不含成本、毛利、毛利率、Markup，產生真實 PDF |
| 10 精度 | 十進位小數運價、匯率與四捨五入，跨幣別缺匯率不產生錯誤合計 |

其他重要邊界包含 Normal／MIN、未填級距、總重量只進位一次、航空公司優先、候選歧義、停用客戶、修訂關聯、未來合約版本、相同合約編號多航線、已含費用的臨時重複計收防護及交易保存。

## 本機重跑

```powershell
npm ci --ignore-scripts
npm run db:setup
npm test
npm run typecheck
npm run build
npm start
```

開啟 `http://127.0.0.1:3000`，確認畫面正常；執行下列操作時使用明確標示的測試客戶，不要把測試價格當成真實合約。這些操作會寫入目前資料庫，請使用空白測試副本或先備份。

1. 設定公司名稱、Logo、匯率使用日期；條款由測試者自行填寫。
2. 新增測試客戶 A、B，新增 A 的 TPE → LAX 合約與 +300 KG USD 4.30。
3. 輸入 10 件、70 × 60 × 60 cm、單件 35 KG，確認重量和運費。
4. 輸入 USD 1,344 成本，檢查毛利並切換成本完整性／預估狀態。
5. 保存報價，確認歷史可讀取；下載 PDF，確認客戶內容、繁體中文字型及內部資訊隔離。
6. 將合約運價修改並保存新版本，重新開啟原報價，確認金額不變。
7. 由歷史報價建立修訂，確認來源仍可查看且沒有覆寫。
8. 停止並重新啟動服務，確認客戶、合約與報價仍存在。
9. 在資料庫副本上測試備份與還原，確認歷史 PDF 仍可重建。

## 已執行結果

驗證環境：Node.js 24.22.1、npm 11.9.0、Next.js 16.4.5、Prisma 6.19.0，使用 lockfile 固定安裝結果。

| 實際檢查 | 結果 |
| --- | --- |
| `npm ci --ignore-scripts` | 成功重新安裝 183 個套件，無需 Prisma 原生引擎下載 |
| `npm run db:setup` | 成功建立資料庫並套用 migration；重跑顯示無待套用項目 |
| `npm test` | **58 passed、0 failed、0 skipped**：引擎 34、SQLite 整合 11、PDF 5、本機 API 4、Logo 4 |
| `npm run typecheck` | 通過；先以官方 `next typegen` 產生 route types |
| `npm run build` | 通過；使用官方 Webpack 編譯器 |
| `npm run dev` | 僅綁定 127.0.0.1；首頁、設定 API、客戶 API 均回傳 200 與預期資料 |
| `npm start` | production server 啟動成功，實際操作與 PDF 請求成功 |
| Chromium 瀏覽器驗收 | 設定 → 新增客戶 → 表格輸入合約 → 多件貨物 → 成本 → 試算 → 儲存 → 下載 PDF → 新修訂 → 重新載入，全部通過，無 browser page errors |
| 備份與還原 | 停止測試伺服器、複製 SQLite、以副本重新啟動；`integrity_check = ok`，兩份報價／修訂仍可讀，原始 PDF 可重建 |

瀏覽器使用明確標示 Demo 的獨立暫存資料庫。實際得到實重 350 KG、材積重與計費重 420 KG、售價 USD 1,806.00、成本 USD 1,344.00、毛利 USD 462.00、毛利率 25.58%。原報價維持 Draft，新修訂為 Accepted。正式工作資料庫沒有插入示範客戶、合約或報價。

PDF 以 `pdftotext` 擷取真實檔案，確認繁體中文、售價與內部資訊隔離。單頁報價以 `pdfinfo` 確認為 1 頁，頁尾沒有額外空白頁。沒有安裝 `pdftotext` 的 Windows 電腦會略過 2 項文字擷取測試，其餘 PDF 產生、頁數與欄位隔離測試仍會執行。

Windows 實機驗證需在目標 Windows x64／Node.js 24 LTS 電腦執行；Linux 測試結果不能替代。Windows 驅動由 npm 平台套件提供，但本次沒有 Windows 執行環境，因此未宣稱 Windows 測試通過。

## Codespaces 設定驗證（2026-11-05）

加入私人 Codespaces 預覽設定後，完整回歸結果為 **77 passed、0 failed、0 skipped**：計算 34、SQLite 11、PDF 5、Logo 4、API 6、預覽來源 11、程序生命週期 6。`npm run typecheck` 與 `npm run build` 均通過；既有 Windows／本機啟動指令保留。

`.devcontainer/setup.sh` 已在目前 Linux 工作區實際執行，重裝鎖定依賴並重跑 migration，既有 `.env` 和資料庫保留。使用獨立暫存 SQLite 與模擬 GitHub Codespaces 環境變數，實際執行 `codespaces:start`、重複啟動、`codespaces:stop` 和重新啟動。重複啟動重用服務；重啟後兩份測試報價與 USD 462.00 毛利快照保持不變。PID 重用、無主子程序群組、不可確認所有權等情境以回歸測試驗證，不會誤停無關程序或誤報已可安全備份。

以原生 HTTP 用戶端模擬代理的外部 Host／HTTPS Origin／X-Forwarded-Host，完成建客戶、合約、420 KG 報價、USD 1,806.00 收入、USD 462.00 毛利及 PDF 下載。API 與 PDF 接受目前工作區的精確預覽網址，拒絕其他工作區、偽造轉送主機與跨來源寫入；Next.js 開發資源也已驗證目前預覽 Origin 可用、其他工作區 Origin 被拒絕。

以上為本機模擬及自動化驗證，**本次沒有建立真正的 GitHub Codespace，也沒有宣稱容器映像建置、GitHub 帳號驗證或平台轉送已實測成功**。實際使用時依 [Codespaces 操作說明](codespaces.md) 建立／重建容器，並維持 3000 連接埠 Private。私人連接埠由 GitHub 驗證；應用程式仍沒有自己的登入權限。

## 海空運國家價擴充驗證（2026-11-05）

依使用者確認的規則，空運以 KG、海運併櫃以 CBM、海運整櫃以指定櫃型的櫃數計費；起訖國家相同且合約其他條件相符時，目的國不同城市套用同一份單位運價。每項派送／附加費是否已含仍由合約逐項標記，不假設全包。

最終完整結果為 **102 passed、0 failed、0 skipped**，共 9 個測試檔：既有引擎 34、海空運／國家計價 15、資料保存 16、原資料庫升級 1、PDF 9、API 6、Logo 4、預覽來源 11、程序生命週期 6。`npm run typecheck`、`npm run build` 均通過。

追加式 migration 已對只有原始 schema 的資料庫副本執行，保留舊客戶、合約版本、正規化報價資料、修訂關係及**舊 snapshot JSON 原始字串**。舊資料預設為 AIR／AIRPORT／PER_KG，不會猜測或自動轉成國家價。國家合約識別方式另測試了特殊分隔字元，不會誤把不同承運人／服務條件當成相同合約。

真實 Chromium 操作在獨立暫存 SQLite 建立三份明確標示 Demo 的合約與三份報價：

- 空運 TW → US：同樣 420 KG 貨物，在 Los Angeles 與 New York 均為 USD 1,806.00。
- 海運 LCL TW → US：2.52 CBM × Demo 單價 USD 100，加未含文件費 USD 10，總額 USD 262.00；已含派送費不重收。
- 海運 FCL TW → US：2 × 40HQ × Demo 單價 USD 1,500，總額 USD 3,000.00；不填貨物尺寸／重量仍可計櫃，已含重量類費用不重收，也不顯示虛構零重量。

以上價格只作驗證，不是真實客戶合約。瀏覽器同時驗證合約編輯建立新版本後舊報價金額不變、海運歷史篩選、三種正式 PDF 下載及重新載入後資料保存，無 browser page errors。正式工作資料庫沒有插入 Demo 客戶、合約或報價。

海運 PDF 文字擷取顯示國家、城市／港口備註、CBM 或櫃型／櫃數與售價；不顯示空運材積重或內部成本／毛利。既有空運 PDF、私人 Codespaces 存取限制及備份方式繼續保留。

操作與更新方式見 [海空運國家價操作說明](air-sea-country-rates.md) 與 README；已有資料更新前先備份，停止服務後再執行 `git pull --ff-only`、`npm run db:setup` 及 `npm run codespaces:start`。

## 導覽與 Codespaces 預覽穩定性修正（2026-11-05）

舊版可確認的缺陷：目前功能只存在 `useState('dashboard')`，點擊新增報價後網址仍為根目錄；文件一經重載，就回營運總覽。程式沒有刻意轉址回總覽。舊 Codespaces 預覽為開發模式，可能因 HMR 重連或程式更新發生重載，但本次未直接連入使用者的 Codespace，無法斷定其首次點擊當下的具體觸發事件。

已將功能與修訂／歷史選取改由 URL hash 保存，報價草稿在本分頁暫存；新增渲染錯誤邊界、儲存鎖定、過期試算錯誤檢查與延遲儲存導覽保護。Dashboard 有效合約統計也改用當日適用版本。Codespaces 預覽改為 production：每次停止後啟動會先遷移與重新建置，再執行 `npm start`，保留手動 `npm run dev` 除錯方式。

最終結果：**122 passed、0 failed、0 skipped**，共 12 個測試檔。包含實際 React／DOM 測試 9、URL／當日合約版本測試 5、草稿格式／隔離／競態測試 5、程序所有權與模式測試 7，以及原有計價、SQLite、PDF、存取限制測試。`npm run typecheck` 與 production build 通過。使用新 lockfile 執行 `npm ci --ignore-scripts` 重新安裝 232 個套件後，再跑 `db:setup`、122 項測試與 typecheck 全部通過。

真實 Chromium 經本機模擬的 Codespaces HTTPS 代理連至已編譯服務，驗證：

- 點擊新增報價沒有產生文件重載，網址為 `#quote`。
- 重新整理後保留報價頁與貨物／城市草稿；Back／Forward 正常。
- 延遲儲存期間欄位鎖定；離開再回同一報價頁、輸入新草稿後，先前儲存完成不會搶走畫面或刪掉新草稿。
- 歷史報價選取及修訂草稿在重載後保留；新報價與修訂草稿分開。
- 瀏覽器 page errors 為 0，HMR WebSocket 數為 0。

新的 production 啟動流程、就緒檢查、重複啟動重用及停止自有程序群組均實際執行成功。測試使用獨立暫存 SQLite，正式工作資料庫沒有加入 Demo 資料；本次沒有新增或破壞資料庫 schema。詳細檢查與更新步驟見 [導覽問題修正說明](navigation-fix.md)。

## 新增客戶即時顯示修正（2026-11-05）

確認舊程式存在兩項缺陷：保留的搜尋／狀態篩選會隱藏剛建立的客戶；新增時丟棄 POST 回傳資料並等待四個 API 的 `Promise.all`，其中任何讀取失敗都會阻止客戶清單更新，並將已完成的寫入錯誤呈現為儲存失敗。

修正後，客戶 POST／PUT 成功回傳的正式資料會立即更新共用客戶清單，並使寫入前已發出的過期讀取失效。新增或修改後清除篩選、標示並顯示已儲存客戶；背景讀取錯誤分開提示「已儲存」，提供同步重試，避免重複新增。儲存期間鎖定欄位與防止重送；失敗的 POST 保留輸入，舊刷新也不會關閉新開的客戶表單。

完整回歸：**130 passed、0 failed、0 skipped**，共 13 個測試檔。新增客戶介面測試 8 項，原有 122 項繼續通過。`npm run typecheck` 與 production build 通過。

真實 Chromium 透過模擬 Codespaces HTTPS 代理連至隔離 SQLite 的 production 服務，完成以下驗證：搜尋不符新客戶＋INACTIVE 篩選下新增 ACTIVE 客戶，在後續客戶 GET 尚未完成時即顯示新列並清空篩選；刻意注入 contracts GET 500 後仍顯示已儲存與保留資料；切到新增報價可選取新客戶；重新載入後資料仍存在。重複代碼的 409 會保留本次輸入，不會再建立第二筆，瀏覽器 page errors 為 0。

本次只修改顯示與同步流程，沒有更動資料庫 schema 或刪除資料。測試使用獨立暫存資料庫，正式工作資料庫未加入 Demo 資料。既有 Codespace 須拉取最新程式並重新建置／啟動才會生效，單純 GitHub 推送不會更新已開啟的舊程序。

## 空運未滿 45 KG 單價驗證（2026-11-05）

空運合約重量表新增 Normal 列，用於維護未達首個已填級距的小重量單價；最小已填門檻為 +45 時顯示「未滿 45 KG」。沿用既有 Normal 欄位，不需資料庫 migration，舊合約價格可直接編輯；自訂 +30、只有 +100、未填級距及零單價的實際適用範圍均有測試。海運維持每 CBM／每櫃的 Normal 欄位，MIN 保持整票固定下限。

完整回歸結果為 **141 passed、0 failed、0 skipped**，共 14 個測試檔；`npm run typecheck` 與 production build 通過。新增 4 項計算邊界與 7 項合約表單測試。

Chromium 透過本機模擬 Codespaces HTTPS 代理操作 production server，在獨立暫存 SQLite 新增 Normal = USD 6/KG、+45 = USD 5.8/KG、MIN = USD 50 的 Demo 合約，完成保存、重載、編輯讀值及報價試算：

| 實重 | 計費重 | 適用單價 | 基本運費 |
| --- | --- | --- | --- |
| 44.5 KG | 44.5 KG | Normal · USD 6/KG | USD 267.00 |
| 45 KG | 45 KG | +45 · USD 5.8/KG | USD 261.00 |
| 44.6 KG | 45 KG（0.5 KG 進位） | +45 · USD 5.8/KG | USD 261.00 |

瀏覽器無 JavaScript 錯誤，API 保存的是 Normal 與正數 +45 門檻，未新增零或負級距。以上使用虛構測試價格，未將 Demo 資料寫入正式工作資料庫；本次沒有直接測試真正的 GitHub Codespace。

## Trucking Charge 重量級距驗證（2026-11-05）

合約及臨時附加費新增「重量級距 Per KG」計價，獨立維護 Normal、+45／+100／+300／+500／+1000 與自訂級距。新增 migration `20261105000300_tiered_charge_rates` 保存附加費級距及套價資訊；舊級距、一般附加費與報價 snapshot 原始字串保留。

完整回歸結果為 **169 passed、0 failed、0 skipped**，共 17 個測試檔；型別檢查與 production build 通過。新增／擴充測試涵蓋獨立級距、MIN、零價格、未達較高門檻不偷套低價、海運實重、已含 FCL 無貨物、單次調價、版本及資料庫升級、表單切換、草稿恢復與客戶 PDF 欄位隔離。

Chromium 透過本機模擬 Codespaces HTTPS 代理操作 production server，使用獨立暫存 SQLite 及虛構 Demo 價格：Trucking Normal USD 2/KG、+45 USD 1.5/KG、+100 USD 1/KG、最低 USD 10。

| 實重 | 計費重 | Trucking 級距 | Trucking 金額 |
| --- | --- | --- | --- |
| 44.5 KG | 44.5 KG | Normal | USD 89.00 |
| 45 KG | 45 KG | +45 KG | USD 67.50 |
| 44.6 KG | 45 KG | +45 KG | USD 67.50 |
| 100 KG | 100 KG | +100 KG | USD 100.00 |

畫面中的本次單價同步選價；100 KG 本次覆寫為 USD 0.9/KG 後，保留原額 USD 100，套用額 USD 90。另一項已含 Trucking 為零；臨時級距費用在重載草稿後仍可試算 USD 20，含基本運費後總應收 USD 690，保存時排除未填單價級距。新增合約版本後，舊報價快照保持相同，瀏覽器無 JavaScript 錯誤。

PDF 在模擬代理下實際回應 200／有效 PDF，另以本機 HTTP 的真實 Chromium 下載驗證。`pdftotext` 確認 +100 KG、100 KG、USD 0.9/KG、USD 90 及總額 USD 690，沒有內部成本／毛利；`pdfinfo` 確認一頁。沒有將 Demo 寫入正式工作資料庫；本次未直接測試真正 GitHub Codespace 的平台下載行為。

## 海關三旬匯率與材積顯示驗證（2026-11-06）

加入使用者提供的官方 GC331 `CURRENT_JSON` 來源，Settings 與報價均可選海關三旬或手動匯率，海關來源可選買進／出口或賣出／進口欄位。伺服器依出貨日檢查適用期間，預覽與保存時核定取率並保存來源、類別、期間及擷取時間；不接受瀏覽器偽造的海關匯率或來源資訊。migration `20261105000400_customs_exchange_rates` 在 Settings 追加來源與類別，舊報價快照維持原始字串。

完整回歸為 **230 passed、0 failed、0 skipped**，共 22 個測試檔；`npm run typecheck` 與 production build 通過。新增案例包含 25 項下載／解析／日期／快取／失敗條件、11 項權威取率與資料保存、9 項取率及設定畫面、6 項報價來源與請求競態、9 項材積顯示及 1 項 PDF 兩位顯示。原手動匯率歷史案例明確選用 `MANUAL`，保留既有金額與歷史不變的斷言。

真實 Chromium 透過本機模擬 Codespaces HTTPS 代理操作 production server，使用獨立暫存 SQLite：

- 官方取率 API 在目前受限的開發環境回應 502，畫面顯示失敗且禁止用舊率儲存，明確切到手動後可編輯與保存。
- 以來源文件記載的歸檔 fixture，驗證買進 32.455、賣出 32.555 的畫面切換及適用期間。此項是受控回應測試，不是官方即時取率成功；應用程式執行時沒有第三方備援來源。
- 一件 61 × 41 × 37 cm、實重 8 KG，材積重原始值為 `15.422833333…`，顯示 `15.42 KG`，計費重量仍是 `15.5 KG`。畫面、歷史與 PDF 都使用兩位材積顯示，貨物輸入及快照原值不截短。
- 明確使用手動 Demo 匯率 32.5，USD 100 售價換算 TWD 3,250，成本 TWD 1,000，毛利 TWD 2,250。保存、重載與 PDF 均成功，無瀏覽器 JavaScript 錯誤。

`pdftotext` 確認實際 PDF 包含 `材積重量：15.42 KG` 與計費重量 `15.5 KG`；`pdfinfo` 確認一頁。測試資料沒有寫入正式工作資料庫。

官方海關網域目前仍受本開發環境的出口網路白名單限制；已儲存允許 `portal.sw.nat.gov.tw` 的環境草稿，尚待儲存／發布後才能完成官方實連驗證。此限制不代表使用者自己的 GitHub Codespace 也被阻擋。資料形狀與可重跑步驟見 [海關匯率說明](customs-exchange-rates.md)。

## 第一版未納入

正式身分驗證與存取控制、外網部署、客戶入口、航空公司即時 API、自動成本來源、海關歷史／未公告期間的匯率查詢、Weight Break Optimization、批次 Excel 匯入匯出、多使用者協作、會計入帳與稅額計算。不提供未接資料庫的假操作按鈕，也不自動建立真實客戶或運價。
