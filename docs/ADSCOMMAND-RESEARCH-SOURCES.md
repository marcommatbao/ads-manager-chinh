# AdsCommand — Nguồn nghiên cứu và ma trận giấy phép

Ngày tổng hợp: 26/11/2026. Phục vụ [kế hoạch nâng cấp](ADSCOMMAND-UPGRADE-PLAN.md), không phải danh sách dependency được duyệt.
Nguồn được main xác minh qua GitHub API, README và LICENSE công khai ngày 26/11/2026; ghi trực tiếp dưới đây để không phụ thuộc file nghiên cứu tạm.
Không tải/chạy code repo bên ngoài hoặc truy cập phần mềm Noti. Main đã đối chiếu root LICENSE tại các SHA nghiên cứu được liệt kê; kiểm exact subpaths/dependencies vẫn là gate khi áp dụng.

## 1. Noti: capability công khai, không phải bằng chứng vận hành

Nguồn: https://go.noti.vn/product/ai-ads-agent ; điều khoản: https://go.noti.vn/terms và inline license được main đọc.
Nhãn toàn bộ hàng này: **PUBLIC — advertised, chưa kiểm chứng độc lập**.

| Công bố công khai | Ý nghĩa cho AdsCommand | Giới hạn / phase |
|---|---|---|
| Monitoring 15 phút, lịch cấu hình từ 10 phút | Có lịch kiểm và heartbeat, cadence theo quota | Không mặc định cùng tần suất mọi nguồn; P5 |
| Daily Telegram; Web/Telegram/Zalo/voice | Brief và link mở việc | Dùng channel hiện có; Zalo/voice deferred; P3/P5 |
| Specialist agents | Chẩn đoán theo domain | Dùng checklist deterministic, không thêm multiagent framework |
| Proposed changes approve/reject/edit, dry-run | Diff và người duyệt trên web | Existing coordinator cần trusted ingestion/runtime; P7 |
| Stop-all, hard count/budget/change caps, account permissions | Kill switch nhiều scope, quota theo company/currency | Không coi copy UI là đủ enforcement; P7 |
| Outcome sau 3/7 ngày | Checkpoints và inconclusive/confounders | Không suy causal lift; P4/P8 |
| Content review | Brief/profile/review có version | Reuse creative/profile hiện có; P8 |
| Self-host Docker/Postgres | Khả năng triển khai được quảng bá | Không là lý do chuyển DB/stack AdsCommand |
| Ask default / bounded-auto / full-auto | Tham chiếu cấp giám sát | AdsCommand bắt đầu supervised, không tự mở auto |

Điều khoản/inline license hạn chế dùng licensed code/content/prompts/memory cho sản phẩm cạnh tranh và automation/extraction.
Chỉ so sánh capability ở mức công khai và hiện thực độc lập; không copy code, prompt, bộ nhớ, cấu trúc nội dung độc quyền; không benchmark dịch vụ hoặc lấy quyền truy cập đối thủ.
Không kết luận Noti có mọi platform/API hay hiệu suất thực tế như công bố.

## 2. GitHub: evidence/license matrix

### Snapshot nghiên cứu có thể truy vết

Main đã đọc root LICENSE tại SHA dưới đây qua GitHub Contents API; README/metadata cũng được đọc công khai cùng ngày. Đây là snapshot nghiên cứu, không tự phê duyệt nâng version dependency hoặc mọi subpath.

| Repository | SHA nghiên cứu / license đã đối chiếu |
|---|---|
| Opteo/google-ads-api | [e2ad5a949edf7856d454a9eae8dff1ac93e61b82](https://github.com/Opteo/google-ads-api/blob/e2ad5a949edf7856d454a9eae8dff1ac93e61b82/LICENSE) — MIT |
| meta/facebook-nodejs-business-sdk | [46fb58375a4cc0858ab435e6a7cf23f9d03e2985](https://github.com/meta/facebook-nodejs-business-sdk/blob/46fb58375a4cc0858ab435e6a7cf23f9d03e2985/LICENSE) — custom Meta Platform license |
| googleads/google-ads-python | [6ae994bbbb751e28c3be55ad4759c6cc5298708d](https://github.com/googleads/google-ads-python/blob/6ae994bbbb751e28c3be55ad4759c6cc5298708d/LICENSE) — Apache-2.0 |
| google/data-layer-helper | [4a65b385db1fac710d33bf5d1345e598e3d117fc](https://github.com/google/data-layer-helper/blob/4a65b385db1fac710d33bf5d1345e598e3d117fc/LICENSE) — Apache-2.0 |
| google/meridian | [24f23e32edc32fa86b4595cb11fd8730ce74f4f5](https://github.com/google/meridian/blob/24f23e32edc32fa86b4595cb11fd8730ce74f4f5/LICENSE) — Apache-2.0 |
| coreyhaines31/marketingskills | [8fd2fcade2fd6629026e9dfe6d133b55b36968b9](https://github.com/coreyhaines31/marketingskills/blob/8fd2fcade2fd6629026e9dfe6d133b55b36968b9/LICENSE) — MIT |
| triggerdotdev/trigger.dev | [e0e60ff6ca5e4214f91fef2b231dc14d937bdba3](https://github.com/triggerdotdev/trigger.dev/blob/e0e60ff6ca5e4214f91fef2b231dc14d937bdba3/LICENSE) — root Apache-2.0 |

Ưu tiên cùng stack: [Opteo/google-ads-api](https://github.com/Opteo/google-ads-api) là upstream của dependency TS hiện dùng, **không chính thức của Google**. Giữ client hiện có, học auth/error/stream handling; README upstream mới không chứng minh tương thích version đang cài, không auto-upgrade. [Meta Node SDK](https://github.com/meta/facebook-nodejs-business-sdk) là tham chiếu cùng ngôn ngữ cho schema/version/error; chưa thêm SDK mới, chịu cùng license Meta/Platform Policy.


Metadata “pushed” chỉ là thời điểm hoạt động repo được main ghi nhận, không chứng minh chất lượng/bảo mật hoặc release đã kiểm.
Mọi áp dụng sau này phải pin commit/tag, kiểm exact path/license/deps/NOTICE/API terms; root license không bao trùm mọi asset và dependency.

| Repository và evidence links | License thực tế / tình trạng tại ngày nghiên cứu | Giá trị và quyết định |
|---|---|---|
| [googleads/google-ads-python](https://github.com/googleads/google-ads-python); [README main/README.rst](https://github.com/googleads/google-ads-python/blob/main/README.rst); [LICENSE](https://github.com/googleads/google-ads-python/blob/main/LICENSE) | Apache-2.0; nonarchived; pushed 2026-11-23 | Official client: credentials/query/errors/pagination. Tham khảo patterns; giữ TS `google-ads-api` hiện có, không thêm Python backend. P1/P6/P7 |
| [meta/facebook-python-business-sdk](https://github.com/meta/facebook-python-business-sdk); [README](https://github.com/meta/facebook-python-business-sdk/blob/main/README.md); [LICENSE](https://github.com/meta/facebook-python-business-sdk/blob/main/LICENSE) | **Custom Meta Platform license**, metadata NOASSERTION; active pushed 2026-11-21; old facebook URL redirects | Dùng/copy/modify/distribute cho Facebook APIs chịu Platform Policy/copyright. Không gọi MIT/Apache hoặc reuse không hạn chế. Tham khảo schema/pagination/errors/units/version; giữ TS client hiện có. P2/P7 |
| [google/data-layer-helper](https://github.com/google/data-layer-helper); [README master](https://github.com/google/data-layer-helper/blob/master/README.md); [LICENSE](https://github.com/google/data-layer-helper/blob/master/LICENSE) | Apache-2.0 trong file thật dù metadata NOASSERTION; nonarchived, pushed 2024-06-19 | Queue/listener/merge semantics cho validation dataLayer; cân nhắc maintenance cũ. Không chứng minh platform receipt hay business attribution; reference-only P2 |
| [google/meridian](https://github.com/google/meridian); [README](https://github.com/google/meridian/blob/main/README.md); [LICENSE](https://github.com/google/meridian/blob/main/LICENSE) | Apache-2.0; active pushed 2026-11-25 | Bayesian MMM aggregated geo/national, calibration/experiments, không user-level. README Python 3.11–3.13, khuyến nghị GPU, tested 16GB; optional research sau data/causal readiness, không dependency hiện tại |
| [google/lightweight_mmm](https://github.com/google/lightweight_mmm); [README](https://github.com/google/lightweight_mmm/blob/main/README.md); [LICENSE](https://github.com/google/lightweight_mmm/blob/main/LICENSE) | Apache-2.0; **ARCHIVED**, pushed 2025-06-17 | Không chọn mới; README hướng Meridian migration. Không dựa vào popularity để bỏ qua archived |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills); [README](https://github.com/coreyhaines31/marketingskills/blob/main/README.md); [LICENSE](https://github.com/coreyhaines31/marketingskills/blob/main/LICENSE) | MIT, notice Corey Haines 2025; active pushed 2026-11-25 | Marketing/product/ads/analytics/creative/experiments playbooks. Local đã có docs/marketing-playbooks và THIRD-PARTY-NOTICE; review/version checklist trước runtime, không coi docs là tích hợp hoặc LLM budget engine |
| [triggerdotdev/trigger.dev](https://github.com/triggerdotdev/trigger.dev); [README](https://github.com/triggerdotdev/trigger.dev/blob/main/README.md); [LICENSE](https://github.com/triggerdotdev/trigger.dev/blob/main/LICENSE) | Root Apache-2.0; active pushed 2026-11-25; exact paths/deps cần kiểm khi adoption | Tham khảo durable run identity/checkpoint/queues/retries/observability. Reuse jobs registry trước; không thêm SDK/service hiện tại và không retry provider write mù. P5/P7 |
| [getsentry/sentry](https://github.com/getsentry/sentry) | Metadata NOASSERTION; LICENSE chưa được main review | **Không chọn**; không tuyên bố permissive, không đưa thành dependency khuyến nghị |

Quyết định dependency tối thiểu: **không thêm runtime dependency cho các nguồn trên trong đợt đầu**.
Không có repo/công cụ quảng cáo GitHub ngoài danh sách evidence được suy diễn vào plan.
Không dùng stars, số fork hay ngày push để hứa ROI, độ ổn định hoặc mức duy trì dài hạn.

## 3. Nguồn local và mức chứng minh

Baseline source: `723d12ae14b0f660125864c3a09d181764dddbfc`.
Delta MBI: `7c8d5463db3106c0c23ae072c6fef2a1fbc5c4b9`; authority: `faa5f57ee7429832c79496bb291ea218bf3c7bc8`.

| Nguồn | Điều đã quan sát | Điều không được suy ra |
|---|---|---|
| `CLAUDE.md:3`, `:11`; `docs/ARCH.md:33` | Stack, normalized history, evidence gate, file-lock/atomic write convention | ARCH mô tả briefing, không phải toàn bộ runtime system inventory |
| `docs/ROADMAP.md:1`, `docs/MASTER-IMPLEMENTATION-PLAN.md:19` | Lịch sử gate/phases và các ước lượng cũ | % cũ không dùng làm trạng thái hôm nay; plan mới không ghi % giả |
| `docs/ACCEPTANCE.md:44` | Route suite dùng handler/engine thật, mock clients/auth/history | Không live provider, không chứng minh rate-limit/session thật hoặc route-to-disk ở suite đó |
| `docs/NEXT-EXECUTION-PLAN.md:371`, `:377` | TEST-HISTORY authority 290 PASS/71 skipped; MBI 302 PASS/71 skipped; security delta theo ngày | Không test rerun trong lượt docs; không kế thừa pass sang runtime |
| `lib/settings/saved-credentials.ts:52`; `app/api/settings/google/route.ts:57` | Env thắng startup; admin save cập nhật process.env | Chưa đủ root cause restart: stale env, storage hay encryption key cần xác minh |
| `app/api/settings/google/test/route.ts:43`, `:83` | Test route yêu cầu customer IDs và trả account results | Không gán lỗi debug zero accounts cho route này khi chưa trace consumer |
| `lib/measure/tag-doctor.ts:55`, `:285` | Có cấu hình/đếm/source notes và proposals | Tag fired không platform receipt; screenshot Names không resolved Values |
| `lib/inbox/build.ts:20`, `:215`; `lib/jobs/registry.ts:6` | Inbox/ranking/cron descriptors đã có | Registry không là lịch chạy thật; docs playbooks không runtime adoption |
| `lib/automation/approval-store.ts:65`, `:100`; `lib/automation/execution-coordinator.ts:209` | Hard guard apply, observation-only, SQLite transaction nội bộ | Không JSON-SQLite atomicity, trusted ingest, receipt verification hoặc live adapter readiness |
| `docs/ACCEPTANCE.md:74`; `lib/attribution/report.ts:10` | Lead-order matcher và khoảng trống provider campaign binding | Click-ID/label match không tự là campaign revenue đáng tin |
| `lib/finance/company-pnl.ts:29`, `:213`; `lib/mbi-order-sources.ts:33`, `:93` | MBC Report API revenue; MBI paid orders bảy nguồn; notify source 29 | Không đổi team/type/payment/date hoặc tự gán host/source mới |
| `docs/BETA-RUNTIME-VERIFICATION.md:5` | Có URL canonical ghi nhận và boundary chưa có host management | URL/browser từng thấy không chứng minh isolation/volume/image/replica/source commit hiện chạy |

Main evidence ghi user báo redeploy reset Google; live invalid_client từng được xác nhận sau save thành công.
Đây là observation do main cung cấp, không là live probe của lượt lập plan. Sửa credential/health là ưu tiên đầu, không đợi phase write.
Main evidence ghi bảy nguồn MBI đã release; commit cuối ghi release build. Không tuyên bố mọi gate đã browser/live verify trên commit cuối.

## 4. Tài liệu phương pháp và UI

- `MINI_SPEC_PLAYBOOK.md` tại `/home/coder/workspace/projects/audit-ads/`: dùng core v2 Context/Goal/Constraints/Scope A–E/Audit/ONE design/Test/Success và report mục 7; không chuyển luật riêng mục 13 audit-ads sang repo này.
- `ui-ux-resource-navigator/SKILL.md`: dùng brief, 2–3 references, tokens trước, đủ states, trung thực dữ liệu, i18n BA review và checklist responsive/keyboard; chỉ planning.
- `mb-plan/SKILL.md`: đọc code liên quan, chỉ rõ file/thứ tự/rủi ro/test/rollback; không mở rộng sang implementation hoặc production.
- UI references chọn trong plan: local Health/Inbox, https://ui.shadcn.com/, https://recharts.org/; external UI links chỉ references, chưa review tài nguyên exact path cho copy/adoption.
- Local tokens `app/globals.css:13`, `:79`, `:103`; dependencies `package.json`: shadcn/Base UI, Lucide, Recharts hiện có. Không thêm library từ catalog vì tên phù hợp.

## 5. Checklist trước khi dùng nguồn trong triển khai

- [ ] Ghi immutable upstream commit/tag, exact paths, license text, NOTICE/copyright và transitive licenses.
- [ ] Kiểm API terms/version/scopes và dữ liệu được gửi/giữ; custom Meta license được review đúng phạm vi.
- [ ] Không tải secret, dữ liệu khách hàng, prompts nội bộ hay raw provider payload lên công cụ nghiên cứu.
- [ ] Chứng minh lợi ích consumer bằng test/UI slice; dependency mới phải có lý do vượt reuse hiện tại.
- [ ] Ghi source/checklist version vào artifact để truy vết; review supply chain/security trước enable.
- [ ] Tách CODE, TEST-HISTORY, DEPLOY-RECORDED, RUNTIME-PENDING và PROPOSED trong báo cáo; không nâng mức bằng chứng bằng suy luận.
