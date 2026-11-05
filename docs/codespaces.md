# 在 GitHub Codespaces 執行 TEC

Codespaces 讓你以 GitHub 帳號在瀏覽器使用本專案，不必在 Windows 安裝 Node.js。這是你自己的開發工作站，與 GitHub Actions 的自動測試不同，也不是 GitHub Pages 靜態網站部署。

## 第一次建立

1. 登入 GitHub，開啟 [waynehsu28/TEC](https://github.com/waynehsu28/TEC)，確認分支為 `main`。
2. 選 **Code → Codespaces → Create codespace on main**。若出現進階選項，使用倉庫中的 `.devcontainer/devcontainer.json`。
3. 等待容器建立與安裝完成。設定採用官方 Node.js 24 容器，依 lockfile 執行 `npm ci --ignore-scripts`，保留既有 `.env`，再執行 `npm run db:setup`。
4. 容器每次啟動會自動執行 `npm run codespaces:start`。服務停止時，指令會先套用資料庫 migration、編譯目前程式碼，再以 `npm start` 在背景啟動 production 預覽，等設定 API 回傳成功才顯示 ready。編譯可能需要數分鐘，請等待終端機完成；已就緒且由本啟動器管理的 production 服務會直接沿用，不會重複編譯或再開一份。
5. 在底部 **Ports** 找到連接埠 **3000**，確認 **Visibility = Private**，再按 **Open in Browser**。若未自動開啟 Ports 面板，可由 **View → Terminal** 開啟底部面板後選取 **Ports**。
6. 初次畫面沒有測試客戶或價格。先設定公司資料，再建立自己的客戶與合約。

若 GitHub 帳號或組織尚未開放 Codespaces，請依 GitHub 顯示的帳號／組織設定處理。建立畫面會顯示計費對象；請確認帳號額度、機器規格與可能的使用費用，完成後停止不使用的 Codespace。

## 已有 Codespace 如何套用設定

先保存自己尚未提交的程式碼修改，取得倉庫最新 `main`；不要直接覆寫自己的修改。接著按 **Ctrl+Shift+P** 開啟命令面板，執行 **Codespaces: Rebuild Container**，等待安裝與啟動完成。

重新連線到已停止的 Codespace 時，啟動器會重新編譯及啟動背景服務。若只需重新確認目前服務，可在專案根目錄執行：

```bash
npm run codespaces:start
```

若之前使用舊版自動啟動的開發服務，先執行 `npm run codespaces:stop`，再執行 `npm run codespaces:start`。啟動器不會把開發服務或其他程式誤判成已就緒的 production 預覽，也不會停止不屬於本專案的程序。

日常預覽使用已編譯的 production 程式，不會連線至開發模式的 HMR。更新程式碼後，請停止服務並重新執行 `npm run codespaces:start`，讓新程式完成編譯後再開啟預覽。功能頁會由網址保存，重新整理後會回到該功能。未儲存的報價草稿暫存在目前瀏覽器分頁，重整後可恢復；恢復後仍須重新試算並明確儲存至 SQLite。關閉分頁不保證草稿保留，其他管理表單更新前仍請先儲存。

需要手動除錯時，先執行 `npm run codespaces:stop`，再在終端機執行 `npm run dev`。除錯結束後按 `Ctrl+C`，再執行 `npm run codespaces:start` 恢復 production 預覽。

不用執行 `gh auth login`，不用另建 Personal Access Token，也不要把權杖貼進 `.env` 或聊天訊息。

## 私人預覽與存取範圍

GitHub 官方說明指出，forwarded ports 預設為 Private，Codespace 重新啟動時會將曾設為 Public 的連接埠恢復 Private。Private 連接埠只有 Codespace 建立者經 GitHub 驗證後可存取。請仍在每次開啟 Ports 面板時確認 **Private**，不要改為 Public 或組織共享。

本專案的 API、PDF 及手動除錯時的 Next.js 開發預覽，只額外接受執行中 Codespace 的精確 3000 連接埠網址。網址由 GitHub 提供的 `CODESPACES`、`CODESPACE_NAME` 與 `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` 組成；不會開放所有 `*.app.github.dev`，也不需要允許任意網域。原有本機 `127.0.0.1` 操作仍保留。

Host／Origin 檢查不是應用程式登入。私人預覽仰賴 GitHub 平台的身分驗證；若使用者手動把連接埠設為 Public，知道網址的他人可能存取系統。因此這項設定不能用於公開網站或正式多人服務。

官方參考：[Security in GitHub Codespaces — Port forwarding](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces#port-forwarding)。

## 無法開啟時

先確認容器安裝已完成、使用連接埠 3000，且登入的是建立這個 Codespace 的 GitHub 帳號。在專案根目錄執行：

```bash
npm run codespaces:start
```

資料庫設定與編譯過程會直接顯示於終端機；其中任何一步失敗，都不會繼續啟動服務。編譯完成後才開始最長 45 秒的就緒檢查。查看背景伺服器紀錄：

```bash
tail -n 80 .devcontainer/.state/server.log
```

若顯示開發服務仍在執行或 production 服務未就緒，先執行 `npm run codespaces:stop`，再執行 `npm run codespaces:start`。若連接埠被手動啟動的服務佔用，請回到原終端機按 `Ctrl+C`；啟動器不會擅自停止其他服務。

若顯示缺少依賴或 Client，先停止自動啟動的服務，再重跑設定：

```bash
npm run codespaces:stop
bash .devcontainer/setup.sh
npm run codespaces:start
```

`setup.sh` 保留既有 `.env` 與資料庫，只會安裝鎖定依賴及套用 migration。不要用刪除資料庫、`migrate reset` 或任意改綁 `0.0.0.0` 處理問題。

若出現預覽網址／Origin 被拒絕，確認是在真正的 Codespaces 容器執行，而非只開了 GitHub 網頁編輯器。可只檢查下列非機密名稱：

```bash
printf 'CODESPACES=%s\nCODESPACE_NAME=%s\nGITHUB_CODESPACES_PORT_FORWARDING_DOMAIN=%s\n' \
  "$CODESPACES" "$CODESPACE_NAME" "$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN"
```

`CODESPACES` 應為 `true`；其餘兩項應由 GitHub 提供且不為空。不要為了開預覽把名稱改成其他 Codespace，也不要輸出整份環境變數或權杖。

## 資料保存與備份

預設資料庫為倉庫內的 `prisma/dev.db`，位於 Codespaces 的 `/workspaces` 持久化工作區。停止、重新啟動或重建容器會保留這個檔案；不同 Codespace 各有自己的資料庫，GitHub Actions 的測試資料庫也與它無關。

`.env`、SQLite、背景程序紀錄均被 `.gitignore` 排除。Git 推送及 **Code → Download ZIP** 只包含原始碼，不包含你的客戶、合約或報價。**刪除 Codespace 可能永久刪除尚未下載的資料庫，刪除之前必須另存備份。**

備份前，在專案根目錄執行：

```bash
npm run codespaces:stop
```

這個指令只停止本專案啟動器記錄並驗證的背景服務。若另行手動執行過 `npm run dev`，也要在那個終端機按 `Ctrl+C`；確認其他資料庫工具也已停止。接著從左側 Explorer 找到 `prisma/dev.db`，按右鍵 **Download**，保存到自己的電腦。若改過 `DATABASE_URL`，請下載實際資料庫檔案。不要在程式仍寫入 SQLite 時只複製 `.db`，也不要混用不同時點的 WAL／SHM 伴隨檔。原始碼、`.env` 與字型另行保存；`.env` 如含機密資訊不要上傳 GitHub。下載完成後執行 `npm run codespaces:start` 即可恢復操作。

還原時也應先停止服務、備份目前資料庫，再將備份上傳回實際資料庫位置，執行 `npm run db:setup` 及 `npm run codespaces:start`，確認客戶、歷史報價與 PDF 可讀。不要覆蓋唯一一份可用備份。

## 驗證範圍

本專案提供 Codespaces 設定及對預覽 Host／Origin 的自動化測試。實際 GitHub Codespaces 建立、帳號權限、平台轉送與額度仍取決於你的 GitHub 帳號；本次開發沒有建立真正的 GitHub Codespace，因此不宣稱已完成 GitHub 平台端的實機驗證。
