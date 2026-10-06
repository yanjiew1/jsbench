# JetStream 3 benchmarks for QuickJS

從正式 [WebKit/JetStream 的 JetStream3.0 分支](https://github.com/WebKit/JetStream/tree/06785cf861ac44855f168cbbe829278c2802e6de) 擷取 18 項不依賴瀏覽器、WebAssembly、Intl 或 worker 的 JavaScript workload，提供 QuickJS shell runner。來源固定在 `06785cf861ac44855f168cbbe829278c2802e6de`，所有 `jetstream/upstream/` 測試檔保持原樣。

## 執行

需要含 `std`、`os` 標準模組的 QuickJS `qjs`，不需要 Node.js、npm 或網路下載。可自行編譯 [QuickJS](https://github.com/bellard/quickjs)：`make qjs`。

```sh
make list QJS=/path/to/quickjs/qjs
make bench QJS=/path/to/quickjs/qjs
make smoke QJS=/path/to/quickjs/qjs
make bench QJS=/path/to/quickjs/qjs ARGS='--test js-tokens,async-fs --iterations 5 --repeat 3'
```

也可以直接執行，且不必在 repo 目錄中：

```sh
/path/to/qjs --std /path/to/jsbench/jetstream/run.js --test bigint-bigdenary
/path/to/qjs --std jetstream/run.js --iterations 5 --json > results.json
```

| 參數 | 用途 |
| --- | --- |
| `--list` | 列出 benchmark 名稱與分類 |
| `--test NAME[,NAME...]` | 選擇單項或多項；省略則全部執行，依 manifest 順序 |
| `--iterations N` | 每個實例執行 N 次，預設 3；必須是正整數 |
| `--repeat N` | 重新載入 source 並建立實例 N 次，預設 1 |
| `--json` | stdout 只輸出 JSON，含每次 sample、載入／建構耗時和 pass/fail |
| `--help` | 顯示用法 |

失敗訊息送到 stderr，仍會執行其餘項目；任何 workload 或驗證失敗會回傳 exit code 1。未知名稱、參數錯誤也會回傳非零狀態。

## 合併成可攜的單一檔案

QuickJS 的 `bench-v8` 先產生 `combined.js`，再以 `qjs -d` 執行；這裡也提供同樣方便的入口。建檔需要 Python 3，執行只需要 QuickJS：

```sh
make combined
/path/to/qjs -d build/jetstream.js --test richards --iterations 5
make bench-combined QJS=/path/to/qjs ARGS='--iterations 3'
```

`build/jetstream.js` 內含 manifest、原始 source 與 runner，可搬到其他目錄單獨執行。建檔時會檢查上游檔案 SHA-256，並保留各檔案授權文字與上游 LICENSE。`-d` 是 QuickJS 的記憶體／統計輸出選項；若需純 JSON，請省略 `-d`。產物已加入 `.gitignore`；`make clean` 可刪除。

## 收錄項目

| 分類 | benchmark |
| --- | --- |
| Simple | `hash-map`, `doxbee-promise`, `doxbee-async` |
| Class fields | `raytrace-public-class-fields`, `raytrace-private-class-fields` |
| Generators | `async-fs`, `sync-fs`, `lazy-collections`, `js-tokens` |
| Octane | `crypto`, `navier-stokes`, `raytrace`, `richards` |
| SeaMonster | `ai-astar`, `gaussian-blur` |
| BigInt | `bigint-bigdenary` |
| CDJS | `cdjs` |
| SunSpider | `3d-raytrace-SP` |

這個子集以純 JS、依賴少、能在 QuickJS 合理時間內完成且保有上游 correctness checks 為篩選條件。未收錄 wasm、Intl、worker、瀏覽器啟動與需額外 API shim 的大型 bundle；DeltaBlue 載入時會對 `Object.prototype` 定義不可重設的屬性，無法原樣在同一 process 重複載入，因此未收錄。其他純 JS 項目仍可日後逐一加入，這不是所有相容項目的完整清單。`async-fs`／`sync-fs` 是上游的記憶體內模擬檔案系統，不會操作實際檔案。

## 執行與計時語意

- 參考 QuickJS `tests/microbench.js`，使用 `os.now()` 的單調高解析度時鐘，單位為毫秒。
- 每個 workload 在獨立 function scope 中載入，避免 `Benchmark` 與其他頂層宣告衝突；browserify 的 `globalThis.Benchmark` export 也受到支援。
- 保留上游 `new Benchmark({iterationCount})`、`prepareForNextIteration()`、`runIteration(i)` 和 `validate(iterations)` 順序。async 回傳值會等待完成，拒絕的 Promise 視為失敗；同步 workload 的計時不插入 await。
- 依上游設定安裝相同的 deterministic RNG，在 source 載入前生效，每次 preparation **之後**重設 seed。`performance.now()` 以 `os.now` 提供給 CDJS。執行完恢復 runner 改動的全域值。
- 每個 repeat 重新載入 source、建立實例，repeat 間在計時區外 GC，但仍共用同一個 QuickJS process；需要 process 隔離時請分次啟動 qjs。
- `first_ms` 是第一輪，`median_ms`／`mean_ms` 包含全部 iteration；沒有額外 warmup，也不改小上游每輪的 workload。source 讀取、解析／執行列為 `load_ms`，建構列為 `setup_ms`，preparation 與最後驗證不算入 sample。GC 在 iteration 內自然發生時仍算入耗時。

這些數字是 **QuickJS 子集的原始耗時，不是官方 JetStream 3 分數**。預設 iteration 數、runner 環境與官方 harness 不同，未實作官方 startup／worst-case 計分或整體 geometric mean，不能與 browserbench 分數直接比較。比較結果時請使用相同 qjs 版本、編譯選項、硬體與參數。

## 驗證與授權

```sh
make check QJS=/path/to/qjs
make smoke QJS=/path/to/qjs
```

`check` 測試 runner 的同步／非同步生命週期、驗證失敗、參數錯誤與可攜合併檔；`smoke` 會實際執行全部 18 個上游 workload 一輪。已使用 Bellard QuickJS `535a7c250ff4a577ec36c3e103daab6dadeea650`（2026-06-04、GCC -O2）驗證。

本 repo 新增的 runner、工具與文件採用 [MIT](LICENSE)。上游檔案依各自原始標頭授權（Apple BSD、V8 BSD、Purdue BSD、MIT 等），另保留 [JetStream LICENSE](jetstream/upstream/LICENSE)；根目錄 MIT 不覆蓋上游授權。來源路徑、版本及各檔案 SHA-256 記錄在 `jetstream/manifest.json`。QuickJS 僅用於參考與驗證，未放入 repo。
