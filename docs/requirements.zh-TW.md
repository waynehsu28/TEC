# 專案名稱: Air Freight Internal Quotation System

## 角色與開發目標

你是一位資深全端工程師,熟悉航空貨運承攬(Freight Forwarding)、航空運價計算、客戶合約管理及企業內部報價流程。

請幫我從零建立一套可以實際操作的航空貨運內部自動報價系統。

這套系統主要提供台灣航空貨運承攬公司內部使用。

我希望自行輸入公司與各客戶約定的合約運費,系統能夠根據客戶、航線、計費重量及合約條件,自動計算應向客戶收取的價格。

同時,我要能輸入本次運輸的實際或預估成本,讓系統計算毛利及毛利率。

請直接建立可以執行的專案,不要只提供架構說明、畫面範例或偽程式碼。

第一階段優先開發 MVP,確保核心報價功能完整、計算正確、資料可以保存。

---

# 第一部分: 技術規格

## 1. 開發環境

請使用以下技術:

- Next.js,使用相容且穩定的版本
- TypeScript
- Tailwind CSS
- Prisma ORM
- SQLite
- Zod,用於資料驗證
- Decimal.js 或等效精確十進位計算方案
- 適合 Next.js 的 PDF 產生工具
- Vitest 或相容的自動化測試工具

介面使用繁體中文,保留航空運輸專業英文術語。

第一版只需在 Windows 電腦本機執行,使用瀏覽器操作。

不需要付費 API、雲端資料庫或第三方帳號。

請確保專案可以透過 npm 安裝、啟動及測試。

金額與運價計算不可直接依賴 JavaScript 浮點數進行財務運算。

## 2. 系統模組

第一版只需要以下模組:

1. Dashboard
2. Customer Management
3. Customer Contract Rate Management
4. New Quotation
5. Quotation History
6. Settings

請勿在第一版加入客戶登入網站、航空公司即時 API、複雜權限系統或其他非必要功能。

---

# 第二部分: 客戶資料管理

## 3. Customer Management

建立客戶基本資料管理功能。

欄位包含:

- Customer ID
- Customer Name
- Customer Code
- Contact Person
- Email
- Phone
- Default Currency
- Remarks
- Status

功能包含:

- 新增客戶
- 編輯客戶
- 停用客戶
- 客戶搜尋
- 查看客戶合約運價
- 查看客戶歷史報價

客戶資料應與合約價格及報價紀錄建立資料庫關聯。

---

# 第三部分: 客戶合約運價管理

## 4. Customer Contract Rate Management

這是整套系統最重要的核心功能。

我需要自行維護公司與不同客戶簽訂的航空貨運合約售價。

每個客戶可以擁有多條航線,每條航線可以有不同價格及合約期間。

建立以下欄位:

基本資料:

- Customer
- Contract Number
- Contract Version
- Origin Airport
- Destination Airport
- Airline,可指定或不限定
- Service Type
- Commodity,可選填
- Effective Date
- Expiry Date
- Currency
- Rate Type
- Remarks
- Contract Status

Rate Type 至少包含:

- Base Freight + Surcharges
- All-in Rate

運價級距:

- Minimum Charge
- Normal Rate
- +45 KG
- +100 KG
- +300 KG
- +500 KG
- +1000 KG

支援使用者自行新增其他重量級距。

級距價格可以不同,不必全部填寫。

### 合約價格輸入方式

請設計類似 Excel 表格的操作介面,方便我逐筆輸入及維護不同航線、重量級距及附加費。

支援:

- 新增合約
- 編輯合約
- 複製合約
- 新增航線
- 修改重量級距
- 修改價格
- 修改有效日期
- 停用合約
- 查詢過期合約

合約更新必須保留歷史版本。

不可直接覆寫已被歷史報價引用的合約版本資料。

### 運價計算規則

對於一般 Per KG 重量級距運價,預設使用單一適用級距價格乘以計費重量,不是累進式計價。

例如:

Chargeable Weight = 420 KG

+300 KG Rate = USD 4.30/KG

Air Freight = 420 x 4.30 = USD 1,806.00

MIN、Normal Rate、重量級距與最低收費必須有明確且可測試的判定規則。

不得將 Minimum Charge 誤認為每公斤運價。

第一版不需要自動使用較高重量級距進行 Weight Break Optimization,將此功能留到第二階段,避免不符合個別合約規則。

---

# 第四部分: 合約附加費

## 5. Contract Surcharges

每份合約可以設定以下費用:

- Fuel Surcharge
- Security Surcharge
- Terminal Handling Charge
- AWB Fee
- Documentation Fee
- Customs Clearance
- Trucking Charge
- Pickup Charge
- Other Charges

每項費用需要支援:

- Per KG
- Per Shipment
- Per Piece
- Minimum Charge
- Manual Amount

每項費用可以自行設定金額、幣別及是否包含在基本運價內。

如果合約為 All-in Rate,必須明確記錄已包含哪些費用。

不可重複計算已包含的附加費。

請讓使用者可以在報價時增加臨時費用或調整個別費用,但必須保留原始合約價格及本次調整後價格。

---

# 第五部分: 貨物資料及重量計算

## 6. Cargo Details

使用者建立新報價時,可以輸入:

- Origin
- Destination
- Customer
- Airline
- Shipment Date
- Commodity
- Pieces
- Length(cm)
- Width(cm)
- Height(cm)
- Gross Weight(kg)

需要支援多組不同尺寸的貨物。

每組貨物都可以有不同件數、尺寸及重量。

系統自動計算:

Gross Weight

Volume(CBM)

Volume Weight

Chargeable Weight

### 計算公式

每組貨物:

CBM = Length x Width x Height x Pieces / 1,000,000

Volume Weight = Length x Width x Height x Pieces / 6000

Total Gross Weight = 各組實際重量總和

Total Volume Weight = 各組材積重量總和

Chargeable Weight = MAX(Total Gross Weight,Total Volume Weight)

其中每組 Gross Weight 欄位必須明確區分單件重量與該組總重量,避免重複乘以件數。

材積除數預設 6000,但可在 Settings 調整。

計費重量進位單位預設 0.5 KG,必須可設定。

請在完成各組重量加總後,依設定的規則進位,不要擅自對每一組貨物分別進位。

---

# 第六部分: 自動套用客戶合約運價

## 7. Automatic Contract Rate Matching

建立新報價時,系統必須:

1. 使用者選擇客戶。
2. 輸入起運地、目的地、出貨日期及貨物資料。
3. 自動計算 Chargeable Weight。
4. 查詢該客戶適用的有效合約運價。
5. 核對 Origin、Destination、Airline、Service Type、Commodity 及日期。
6. 判斷適用重量級距。
7. 計算 Contract Air Freight。
8. 加入適用附加費。
9. 產生客戶合約售價。

### 合約匹配規則

只可以使用同一客戶的合約。

不得跨客戶使用運價。

起運地與目的地必須符合。

合約有效日期必須涵蓋出貨日期,起訖日均包含在有效期間內。

若合約指定航空公司、服務類型或貨物種類,報價條件也必須符合。

未指定航空公司的通用合約,不能優先覆蓋符合條件的航空公司專屬合約。

如果出現多份同樣適用的合約,應列出候選合約、版本及匹配條件,由使用者確認使用哪一份。

若沒有符合條件的合約,顯示:

No Valid Contract Rate

此時允許使用者手動輸入非合約售價。

系統不得虛構合約價格,也不得自動把內部成本當成客戶售價。

---

# 第七部分: 成本及毛利計算

## 8. Cost and Profit Calculation

第一版先採用手動輸入成本的方式,不需要完整航空公司運價資料庫。

每份報價可以輸入:

- Airline Freight Cost
- Fuel Cost
- Security Cost
- Terminal Cost
- AWB Cost
- Documentation Cost
- Trucking Cost
- Other Costs

每項成本可以獨立輸入金額及幣別。

系統計算:

Total Revenue = 客戶合約運費 + 應收附加費

Total Cost = 基本航空運輸成本 + 各項實際或預估成本

Gross Profit = Total Revenue - Total Cost

Gross Profit Margin = Gross Profit / Total Revenue x 100%

Markup = Gross Profit / Total Cost x 100%

成本資料可以標示為 Estimated 或 Actual。

如果成本資料未提供,必須顯示 Cost Not Available,不可將缺少的成本視為零,也不能呈現沒有依據的完整毛利率。

如果部分成本尚未確認,只能顯示已知成本的小計及暫估利潤,並清楚標記不完整。

### 幣別處理

支援 TWD、USD。

匯率由使用者手動設定,並記錄使用日期。

不同幣別需要先轉換成選定的報價分析幣別,才能計算總毛利。

未設定必要匯率時,不得顯示跨幣別合併後的總額。

### 毛利警示

若成本超過售價,顯示 Negative Profit Warning。

不得自動修改客戶合約價。

---

# 第八部分: 報價單及歷史紀錄

## 9. Quotation Management

每份報價都必須有獨立編號。

建議格式:

AFQ-YYYYMMDD-0001

報價欄位包含:

- Quotation Number
- Customer
- Origin
- Destination
- Airline
- Commodity
- Pieces
- Gross Weight
- Chargeable Weight
- Contract Rate
- Selling Charges
- Internal Costs
- Gross Profit
- Gross Profit Margin
- Currency
- Validity
- Remarks
- Quotation Status

報價狀態包含:

Draft

Quoted

Accepted

Rejected

Expired

### 歷史報價快照

每份已儲存的報價應保留當時使用的:

- 客戶合約版本
- 適用重量級距
- 實際套用價格
- 附加費
- 成本
- 匯率
- 貨物重量
- 報價條件

即使之後客戶合約修改,歷史報價也不能被改變。

修改已發出的報價時,應建立新修訂版本,避免覆寫原始報價。

## 10. PDF Quotation

建立可以下載的正式客戶報價單。

PDF 必須包含:

- Company Name
- Company Logo,由設定頁面上傳
- Quotation Number
- Quotation Date
- Customer
- Origin / Destination
- Airline
- Cargo Details
- Chargeable Weight
- Freight Charges
- Additional Charges
- Total Selling Price
- Currency
- Quotation Validity
- Terms and Conditions

對外 PDF 不得包含:

- Airline Buying Cost
- Internal Cost Breakdown
- Gross Profit
- Gross Profit Margin
- Markup

報價條件必須可以自行編輯,不可擅自加入未經使用者確認的法律條款或運送承諾。

PDF 產生時應使用當次報價快照,避免合約更新後影響已發出的報價內容。

---

# 第九部分: 資料庫與畫面設計

## 11. Database Design

請至少建立以下主要資料表:

- Customers
- Contracts
- ContractVersions
- ContractRateBreaks
- ContractCharges
- Quotes
- QuoteCargoItems
- QuoteCharges
- QuoteCostItems
- QuoteRevisions
- Settings
- ExchangeRates

請自行規劃必要的主鍵、外鍵、唯一性限制及索引。

合約版本及已儲存報價必須具備完整資料關聯。

重要報價儲存操作應使用資料庫交易,避免只保存部分資料。

運價、金額、匯率應使用能避免浮點誤差的保存格式。

## 12. User Interface

畫面風格請參考企業 ERP 或 Freight Management System。

設計要求:

- 專業、簡潔
- 以桌面電腦操作為主
- 支援表格搜尋及篩選
- 優先提升輸入效率
- 重要數字使用清晰的欄位及千分位格式
- 貨物資料可動態新增多列
- 合約運價可以表格式輸入
- 報價結果清楚區分 Revenue、Cost、Profit
- 不要加入沒有實際功能的按鈕

所有新增、編輯、儲存及查詢功能都必須連接真正的資料庫。

---

# 第十部分: MVP 驗收標準

## 13. 必須通過的測試

請建立自動化測試,至少驗證:

### Test 1: 計費重量

貨物 10 件。

每件尺寸 70 x 60 x 60 cm。

每件實際重量 35 kg。

預期:

Gross Weight = 350 KG

Volume Weight = 420 KG

Chargeable Weight = 420 KG

### Test 2: 客戶合約價格

Customer A

Origin = TPE

Destination = LAX

+300 KG Rate = USD 4.30/KG

Chargeable Weight = 420 KG

預期基本運費:

USD 1,806.00

### Test 3: 成本及毛利

Selling Price = USD 1,806

Buying Cost = USD 1,344

沒有其他費用。

預期:

Gross Profit = USD 462

Gross Profit Margin 約為 25.58%

### Test 4: 合約有效日期

合約到期後不得自動套用。

### Test 5: 客戶隔離

Customer A 的合約不得套用到 Customer B。

### Test 6: 附加費

All-in Rate 已包含的費用不得再次計收。

### Test 7: 歷史紀錄

修改合約運價後,已儲存的舊報價金額必須保持不變。

### Test 8: 成本缺失

成本未輸入時,不得把零成本當成實際成本計算完整毛利。

### Test 9: PDF 資訊隔離

正式客戶 PDF 不得出現內部成本及毛利資料。

### Test 10: 金額精度

測試小數運價、換匯及金額四捨五入,避免浮點誤差。

---

# 第十一部分: 開發順序

請分成以下階段實作。

Milestone 1:

建立專案、資料庫、設定頁面、客戶資料管理及合約運價維護功能。

Milestone 2:

建立 Cargo Details、Chargeable Weight 計算引擎及自動匹配合約價格功能。

Milestone 3:

建立報價成本輸入、毛利計算、報價儲存及歷史快照功能。

Milestone 4:

完成正式 PDF 報價單、必要測試及整體操作流程。

每個 Milestone 都必須確認程式能夠編譯、執行,並通過相關測試。

請勿只建立靜態 UI 或使用不會保存的假資料來假裝功能完成。

沒有真實客戶資料時,可以另外建立明確標示的 Demo Data,不得將測試價格顯示為真實客戶合約價格。

請優先確保計費重量、合約匹配、附加費及財務計算的正確性。

最後請提供:

1. 完整專案檔案。
2. 資料庫建立方式。
3. Windows 安裝步驟。
4. npm 啟動指令。
5. 基本操作說明。
6. 自動化測試結果。
7. 已完成功能及未完成功能清單。
8. SQLite 資料庫備份及還原方式。

系統第一版只允許在本機使用,不要在未實作正式身分驗證及存取控制前,直接公開部署到網際網路。

請開始實作 MVP,依照上述順序開發,遇到未明確定義的商業規則時,採用可設定的設計並記錄假設,不可自行捏造客戶合約條款或運價。