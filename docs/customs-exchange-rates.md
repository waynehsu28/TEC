# 海關三旬匯率

## 操作與適用日期

在 Settings 選「海關三旬匯率」作為新報價預設來源。預設為「出口（買進）」，可改成「進口（賣出）」；報價也可獨立切換來源或類別。匯率方向固定為 **1 USD = 幾 TWD**。

| 畫面類別 | 讀取欄位 |
| --- | --- |
| 出口（買進）／EXPORT | USD 項目的 `buyValue` |
| 進口（賣出）／IMPORT | USD 項目的 `sellValue` |

報價可自行選擇買進或賣出；系統依上述欄位取值，不由起訖國家自動推定類別。

報價以**出貨日**核對資料的 `start`／`end`，起訖日皆包含。官方 `CURRENT_JSON` 只提供目前公告期間，不是歷史日期查詢。所選日期不在回應期間、尚未公告、缺 USD、資料格式錯誤或連線逾時時，系統拒絕自動取率，提示重試或自行選「手動輸入」。不自動套用相鄰期間、過期值或第三方匯率。

修改日期或類別會重新取得對應值，舊請求回應不覆蓋新選擇。預覽與儲存仍由伺服器重新核定自動匯率，覆寫瀏覽器傳入值。報價快照的 `input.customsRate` 保存 `rate`、`date`、`side`、`validFrom`、`validTo`、`sourceUrl`、`fetchedAt`；已保存報價不因下旬匯率更新而重算。

手動匯率繼續可用，需要換匯時填入匯率，並記錄使用日期。舊報價或分頁草稿若沒有匯率來源欄位，維持 `MANUAL`，不自行轉成海關匯率。

## 資料來源與確認範圍

執行時唯一來源為使用者指定的 [官方 GC331 CURRENT_JSON](https://portal.sw.nat.gov.tw/APGQ/GC331!downLoad?formBean.downLoadFile=CURRENT_JSON)。資料形狀為 `start`、`end` 與 `items`；期間日期使用 `YYYYMMDD`，幣別項目包含 `code`、`buyValue`、`sellValue` 字串，系統讀取 USD。

本次開發環境的官方連線遭出口代理 `CONNECT 403` 阻擋，尚未取得官方即時回應。資料格式研究參考 [固定提交的第三方原樣歸檔](https://github.com/kurorido/tw-gc331/blob/5890f477f5c03b9a945e2b5d46a56a0f586b3ad5/gc331_current.json) 及其 [擷取程式](https://github.com/kurorido/tw-gc331/blob/5890f477f5c03b9a945e2b5d46a56a0f586b3ad5/index.js)；這能說明實作採用的資料形狀，不等於官方實連驗證。歸檔不作為應用程式的執行來源或備援。

取率使用固定 HTTPS URL，不跟隨重新導向；透過 Undici 7 沿用環境 HTTP／HTTPS proxy 與 CA 信任，維持 TLS 驗證。需要連網的只有選用海關來源的取率操作；手動來源仍可離線使用。

## 更新與網路設定

新增 migration `20261105000400_customs_exchange_rates` 僅在 Settings 追加來源與類別，預設 `CUSTOMS`／`EXPORT`。保留原資料庫，依 [Codespaces 更新與備份步驟](../README.md#codespaces在-github-瀏覽器操作) 停止服務、備份，再執行 `git pull --ff-only origin main`、`npm ci --ignore-scripts`、`npm run codespaces:start`；啟動時會自動套用 migration。本機安裝則執行 `npm run db:setup` 後啟動。

本次受限的 Codex 開發雲端需要允許 `portal.sw.nat.gov.tw`；相關網路草稿已儲存，但尚未套用，須在環境設定檢視、儲存並發布。這項開發環境限制與你自己的 GitHub Codespace 網路設定不同，不能據此判定 Codespaces 也已被阻擋或已可連線。實際無法取率時，保留錯誤提示，重試或明確改用手動來源。
