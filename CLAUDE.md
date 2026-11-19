# SynoDesign Linter

Figma plugin，掃描 Synology DSM 8.0 產品設計檔，列出違反 8.0 UI Base Guideline 的節點。使用者是 DSM 產品線的設計師：在畫布上選取 Frame → 點掃描 → plugin 遞迴檢查所有子節點（跳過隱藏和鎖定的）→ 結果依類別分群，點任一筆跳到該節點。

## 兩個 remote，不要搞混

- `origin` → `git.synology.inc:lynnchen/guideline-scanner-dsm8.0`（公司 GitLab，程式碼的正本）
- `github` → `github.com/wu0h9625-boop/Guideline-Scanner-DSM8.0`（公開 mirror）

GitHub 這個 remote 存在只有一個原因：**Figma plugin 的沙箱連不進公司內網**。plugin 執行時要從網路抓 `rules.json`，`src/plugin/cache.ts` 的 `DEFAULT_RULES_URL` 指向 GitHub raw，所以 `rules.json` 改完兩邊都要推。cache.ts 裡有一段 migration，會把舊使用者快取中 `git.synology.inc` 的網址改寫成 GitHub 網址，不要刪掉。

## 架構

Figma plugin 分成兩個執行環境，訊息用 `figma.ui.postMessage` / `figma.ui.onmessage` 往返，型別定義在 `src/types.ts`（`UIMessage` 是 plugin→UI，`PluginMessage` 是 UI→plugin）。

`src/plugin/` 跑在 Figma 的沙箱裡，碰得到節點樹但**沒有 fetch**。所以抓 `rules.json` 的流程是：plugin 送 `FETCH_RULES_JSON` 給 UI → UI 用瀏覽器的 fetch 抓 → 回傳 `RULES_JSON_RESULT`。要加任何對外請求都得走這條路。

- `cache.ts` — 設計系統快取（variable collection key、text style、effect style）存在 `clientStorage`，加上從 `rules.json` 套進來的規則；`isCacheStale` 判斷要不要重抓
- `rules.ts` — 所有檢查邏輯，依 check type 分派
- `scanner.ts` — 遞迴走訪節點，對每個節點呼叫檢查
- `main.ts` — 訊息路由、忽略清單的存取

`src/ui/` 是 React，跑在 iframe 裡，有完整的瀏覽器網路權限。`AdminPanel.tsx` 讓管理員改 `rules.json` 的來源網址。

## rules.json

規則不寫死在程式裡。四個 top-level key：

- `version`
- `categoryMap` — 把規則 id 分到使用者看得到的四個類別：版面結構、間距、顏色、文字。**新增規則一定要同時加進 categoryMap**，否則該規則的問題不會出現在任何群組裡
- `spacingConfig` — `leftPaddingIndentMultipleOf`（左側縮排的倍數基準）、`additionalAllowedValues`（額外允許的硬編間距值）
- `rules` — 35 條元件規則，每條有 `id` / `name` / `description` / `targetComponentName` / `checks[]`，另可加 `excludeComponentName(s)`、`targetComponentNames`、`nodeTypeFilter`、`requiredAncestorName`、`exemptHardcodedSpacing`

目前用到 19 種 check type（`mustHaveParentFrame`、`parentItemSpacing`、`ownPaddingByAncestor`、`grandparentItemSpacing`、`fillVariablePrefix` 等）。

要改規則時用 `figma-design-linter-rules` skill，裡面有完整的 check type 說明。

`rules.example.json` 是給其他團隊 fork 用的最小範例，不是這個專案實際讀的檔案。

## 文件

`RULES_GUIDE.md` 是給設計師和管理員看的，會散佈到團隊外。**不要在裡面寫對話脈絡或版本差異。** 附錄 B 寫「4 種 Check 類型」已經過時（實際 19 種），改規則格式時記得一起更新。

## Build

```
npm run build     # UI + plugin 都建
npm run watch     # 開發時用
```

`dist/` 在 .gitignore 裡，但 `manifest.json` 指向 `dist/plugin.js` 和 `dist/index.html`。**clone 下來要先 `npm install && npm run build` 才能在 Figma 裡載入。**

`manifest.json` 的 `id` 是 Figma 發的正式 plugin id，不要改。
