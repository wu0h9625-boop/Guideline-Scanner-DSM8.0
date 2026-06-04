# Design Linter 使用指南

本 Plugin 專為 **Synology DSM 8.0** 產品線設計，搭配 **8.0 UI Base Guideline** 設計系統使用。

本文件分為兩個部分：
- **給設計師**：日常掃描流程（不需要任何設定）
- **給管理員**：安裝 Plugin 與維護元件規則

---

## 給設計師

### 開啟 Plugin

在 Figma 中開啟任一 DSM 8.0 產品設計檔案，右鍵畫布 → **Plugins** → **Development** → **Design Linter**。

第一次開啟時，Plugin 會在背景讀取設計系統規則（轉圈動畫約 3–5 秒），完成後自動進入主畫面。

### 掃描流程

**1. 選取要檢查的範圍**

在畫布上選取想要掃描的 Frame 或 Component，可以多選。

**2. 點「掃描選取範圍」**

Plugin 會遞迴掃描所有子元素（自動跳過隱藏和鎖定的節點）。

**3. 看結果**

結果依問題類型分群，點群組標題可展開或收合：

```
顏色未使用 Token         3 個問題  ▾
間距未使用 Token         5 個問題  ▸
文字樣式未套用           2 個問題  ▸
錯誤或廢棄 Token         1 個問題  ▸
元件使用規則違規          2 個問題  ▸
```

每筆問題會顯示：節點名稱、在畫面中的位置路徑（例如 `Card / Header / Title`）、出問題的屬性（例如 `fill[0]`、`paddingTop`），以及目前的值（例如 `#FF3300`、`13px`）。

**4. 點擊定位**

點任一筆問題，Figma 會自動跳到並選取該節點，可以直接開始修改。

**5. 修改後再掃描確認**

修改完後重新按「掃描選取範圍」，確認問題消失即可。

### 畫布標注（可選）

掃描完成後可點「標注至畫布」，Plugin 會在每個問題節點旁加上紅色標注，方便截圖或設計審查。完成後點「清除標注」移除。

---

## 給管理員

管理員需要做兩件事，每件都只需要設定一次：
1. **安裝 Plugin**：將 Plugin 載入 Figma，讓設計師能夠使用
2. **設定元件規則**：維護一份規則清單，讓 Plugin 知道元件的使用規範

### 一、安裝 Plugin

**前置條件**

- [Node.js](https://nodejs.org/) 18 以上版本
- [Figma Desktop App](https://www.figma.com/downloads/)（瀏覽器版無法載入開發中的 Plugin）

**Step 1：編譯 Plugin**

開啟終端機，進入專案目錄後執行：

```bash
cd "/Users/lynnchen/Documents/figma plugin/figma-design-linter"
npm install     # 第一次使用才需要
npm run build   # 編譯 Plugin 和 UI
```

成功後會看到：

```
dist/plugin.js   ✓
dist/index.html  ✓
```

**Step 2：在 Figma 載入**

1. 開啟 Figma Desktop App
2. 右上角選單 → **Plugins** → **Development** → **Import plugin from manifest...**
3. 在 Finder 中選取以下路徑的 `manifest.json`：
   ```
   /Users/lynnchen/Documents/figma plugin/figma-design-linter/manifest.json
   ```
4. 點「Open」，Figma 顯示「Plugin imported」即完成

**確認安裝成功：** 在任何 Figma 檔案中右鍵畫布 → Plugins → Development → 看到 **Design Linter**。

**往後更新 Plugin（程式碼有變動時）：** 只需重新執行 `npm run build`，不需要重新 import。

---

### 二、設定元件規則

顏色、間距、文字樣式的 Token 規則，Plugin 已根據 Figma Library 自動處理。需要管理員另外設定的，是描述**元件應該怎麼用**的規則，例如「Toolbar 必須包在 Frame 裡，且底部 padding 需綁定 spacing/8」。

**Step 1：建立 rules.json**

複製同目錄的 `rules.example.json` 作為起點，依照 Guideline 填寫規則。

如果有 Guideline PDF，可以用 Claude 的 `pdf-to-design-rules` Skill 自動轉換：

> 「幫我把 /path/to/guideline.pdf 轉成 rules.json」

格式說明見本文件的附錄。

**Step 2：上傳到公司伺服器**

將 `rules.json` 放到 GitLab 或內部伺服器，取得一個可以直接讀取的 URL：

```
https://gitlab.company.com/design/guidelines/-/raw/main/rules.json
```

**Step 3：在 Plugin 後台設定 URL**

1. 在 Figma 開啟 Design Linter
2. 快速點擊標題「**Design Linter**」5 次 → 進入管理員後台
3. 在「規則 JSON URL」欄位貼入步驟 2 的 URL
4. 點「儲存並更新」，確認看到規則清單後關閉

完成後，所有設計師下次開啟 Plugin 時會自動讀取最新規則，不需要任何額外操作。

**Guideline 更新時：** 修改 `rules.json` 並推上伺服器後，Plugin 每 24 小時會自動拉取一次。若需要立即生效，管理員在後台點「重新讀取設計規則」即可。

---

## 附錄 A：DSM 8.0 設計系統規格

### Variable Collection 結構

`8.0 UI Base Guideline` 包含三個 Variable Collection，Plugin 啟動時會自動讀取所有已啟用的 Library：

| Collection | 內容 |
|-----------|------|
| **Primitive** | 底層原始值：`spacing`、`color`、`border-radius`、`motion` |
| **Semantic** | 語意 Token，含 4 個 Mode：Light Mode、Dark Mode、Light Mode - High Contrast、Dark Mode - High Contrast |
| **IC set** | 圖示相關 Token |

以上三個 Collection 都視為合法 Token 來源。只有 Collection 名稱含有 `deprecated`（不分大小寫）的才會被標記為廢棄。

### 允許的間距值

Plugin 自動掃描所有名稱以 `spacing` 開頭的 FLOAT 變數，建立允許的間距清單。`Primitive` Collection 目前的間距規格：

| Variable | 數值 |
|---------|------|
| `spacing/0` | 0px |
| `spacing/2` | 2px |
| `spacing/4` | 4px |
| `spacing/6` | 6px |
| `spacing/8` | 8px |
| `spacing/10` | 10px |
| `spacing/12` | 12px |
| `spacing/16` | 16px |
| `spacing/20` | 20px |
| `spacing/24` | 24px |
| `spacing/32` | 32px |
| `spacing/36` | 36px |
| `spacing/40` | 40px |

設計稿中若 padding 或 gap 的數值不在以上清單，且未綁定 Variable，Plugin 會標記為「間距未使用 Token」。

---

## 附錄 B：rules.json 格式說明

### 基本結構

```json
{
  "version": "1.0",
  "spacingConfig": {
    "allowedValues": [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 36, 40]
  },
  "rules": [
    {
      "id": "toolbar-bottom-padding",
      "name": "Toolbar 外層需設定 bottom padding",
      "description": "包裹 Toolbar 的 frame 底部 padding 必須綁定 spacing/8",
      "targetComponentName": "Toolbar",
      "checks": [
        { "type": "mustHaveParentFrame" },
        { "type": "parentPadding", "side": "bottom", "variableName": "spacing/8" }
      ]
    }
  ]
}
```

**欄位說明：**

- `spacingConfig.allowedValues`：可省略。省略時 Plugin 從 Library 自動萃取間距值
- `id`：規則的唯一識別碼，使用 kebab-case
- `targetComponentName`：部分符合、不分大小寫。`"Toolbar"` 可匹配 `"Nav/Toolbar"`、`"toolbar-small"`
- `description`：違規時顯示給設計師的說明，建議寫具體的修正方式

### 4 種 Check 類型

#### `mustHaveParentFrame`

元件必須直接放在一個 Frame 內（不能直接放在 Section 或 Page 層）。

```json
{ "type": "mustHaveParentFrame" }
```

#### `parentPadding`

元件的父層 Frame 在指定方向的 padding，必須綁定特定 Variable。

```json
{ "type": "parentPadding", "side": "bottom", "variableName": "spacing/8" }
```

- `side`：`"top"` | `"right"` | `"bottom"` | `"left"`
- `variableName`：Variable 名稱需包含此字串（部分符合）。`"spacing/8"` 可匹配 `"Primitive/spacing/8"`

#### `requiredProperty`

元件本身某個 Figma 屬性必須是特定值。

```json
{ "type": "requiredProperty", "property": "cornerRadius", "expectedValue": 12 }
```

常用屬性：

| property | 說明 | 範例值 |
|----------|------|--------|
| `layoutMode` | Auto Layout 方向 | `"HORIZONTAL"`, `"VERTICAL"` |
| `cornerRadius` | 圓角半徑（px） | `8`, `12` |
| `clipsContent` | 是否裁切超出範圍的內容 | `true`, `false` |
| `primaryAxisAlignItems` | 主軸對齊方式 | `"CENTER"`, `"SPACE_BETWEEN"` |

#### `forbiddenProperty`

元件不應設定某個屬性（屬性值為非零、非 null 即報錯）。

```json
{ "type": "forbiddenProperty", "property": "rotation" }
```

### 一個元件可以有多條規則

每條規則只負責一個主題，多個條件必須同時成立時，將多個 check 放在同一條規則的 `checks` 陣列：

```json
{
  "id": "toolbar-frame-with-padding",
  "name": "Toolbar 需包在 Frame 內且設定底部 padding",
  "description": "Toolbar 外層必須有 Frame，且 Frame 的 bottom padding 需綁定 spacing/8",
  "targetComponentName": "Toolbar",
  "checks": [
    { "type": "mustHaveParentFrame" },
    { "type": "parentPadding", "side": "bottom", "variableName": "spacing/8" }
  ]
}
```

完整範例見同目錄的 `rules.example.json`。

---

## 常見問題

**Plugin 開啟後一直轉圈不動？**
可能是 Library 讀取超時。確認 Figma 檔案已啟用 `8.0 UI Base Guideline` Library 且網路正常，重新開啟 Plugin 再試一次。

**為什麼正確套用的顏色被標記為「錯誤 Collection」？**
元素綁定的 Variable 不在 Plugin 從 Library 讀到的清單中。常見原因：Variable 是在本地手動建立的（不是從 Library 套用的），或 Library 未啟用。

**間距值 `0` 會被標記嗎？**
不會，`0` 永遠允許。

**元件名稱要完全一致嗎？**
不需要，部分符合即可（不分大小寫）。規則裡寫 `"Toolbar"` 會匹配 `"Nav/Toolbar"`、`"toolbar-small"` 等。

**Guideline 更新後，設計師需要重新設定嗎？**
不需要。Plugin 在每次啟動時會檢查快取是否超過 24 小時，若是則自動重新拉取最新規則。

注意：每位設計師的快取是存在自己 Figma App 本機的，互相獨立。管理員在後台點「重新讀取設計規則」只會更新**自己的**快取，不會影響其他設計師。其他人的 Plugin 會在各自下次啟動且快取過期時自動更新，最長等待時間為 24 小時。

**設計師看得到管理員後台嗎？**
看得到，只要點標題 5 次就能進去。後台沒有破壞性操作，所以進去看看也沒關係。
