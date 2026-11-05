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

## 第一版未納入

正式身分驗證與存取控制、外網部署、客戶入口、航空公司即時 API、自動成本與匯率來源、Weight Break Optimization、批次 Excel 匯入匯出、多使用者協作、會計入帳與稅額計算。不提供未接資料庫的假操作按鈕，也不自動建立真實客戶或運價。
