# AdsCommand — Kế hoạch nâng cấp sản phẩm

- ID: ACU-v1; ngày 26/11/2026; trạng thái: đề xuất, chưa triển khai.
- Người soạn: agent theo yêu cầu lập kế hoạch; trách nhiệm bên dưới là vai trò đề xuất, không gán người.
- Canonical cho đợt nâng cấp này; ROADMAP/MASTER/NEXT giữ nguyên giá trị lịch sử theo ngày.
- Companion: [ma trận nguồn và giấy phép](ADSCOMMAND-RESEARCH-SOURCES.md).
- Đây là tài liệu thiết kế, không phải quyết định mở quyền, thay cấu hình hay cho phép ghi provider.

## 1. Tóm tắt điều hành

AdsCommand nên trở thành nơi người vận hành biết **kết nối nào tin được, việc gì cần làm, đã làm gì và kết quả ra sao**.
Giá trị trước mắt không nằm ở thêm agent: sửa credential mất hiệu lực sau restart, health trung thực, rồi nối các module đang có thành luồng sử dụng được.
Noti công bố monitoring, briefing, approval và outcome; đó là tham chiếu capability công khai, không phải bằng chứng hiệu quả hay tiêu chuẩn cần sao chép toàn bộ.
AdsCommand có lợi thế riêng: tách MBC/MBI, đối chiếu doanh thu/đơn thực, X-quang Search/PMax/Meta, Hộp việc, đo lường và audit.

Chọn tám phase, mỗi phase phải giao một lát cắt UI → API → xử lý → lưu trữ → bằng chứng; không tiếp tục tích lũy backend chưa có consumer.
P0 là credential/health. Sau đó ưu tiên connection/tracking, Hộp việc, quan sát end-to-end, monitoring, pacing/attribution, supervised apply, rồi creative/experiments.
Profit và MMM là nhánh tùy chọn theo nguồn và nhu cầu; thiếu COGS không chặn doanh thu, đơn hàng, pacing hay các phase chỉ đọc.
Không có tỷ lệ hoàn thành mới trong kế hoạch này; tất cả acceptance ACU dưới đây đều đang chờ kiểm.

## 2. Context và baseline có dẫn chứng

### Quy ước bằng chứng

| Nhãn | Ý nghĩa và giới hạn |
|---|---|
| PUBLIC | Nhà cung cấp công bố; chưa dùng sản phẩm, benchmark hay kiểm chứng runtime |
| CODE | Đã đọc source tại baseline; có module không có nghĩa đã nối vào production |
| TEST-HISTORY | Log/tài liệu ghi kết quả ở thời điểm trước; không phải test chạy lại hôm nay |
| DEPLOY-RECORDED | Có bản ghi phát hành; không tự chứng minh mọi gate trên cùng commit |
| RUNTIME-PENDING | Cần môi trường/cấu hình/bằng chứng thật; không thay bằng build hoặc screenshot cũ |
| PROPOSED | Thiết kế/target/flag mới; chưa có API, schema hay khả năng vận hành này |

Baseline local: `723d12ae14b0f660125864c3a09d181764dddbfc`.
Code sửa bảy nguồn MBI: `7c8d5463db3106c0c23ae072c6fef2a1fbc5c4b9`.
Authority coordinator: `faa5f57ee7429832c79496bb291ea218bf3c7bc8`.
Dẫn chứng `file:line` dưới đây thuộc baseline này; README/LICENSE GitHub được đối chiếu công khai ngày 26/11/2026, chi tiết và SHA trong tài liệu nguồn.

**Kết quả đối chiếu nguồn:** giữ client TS [Opteo/google-ads-api](https://github.com/Opteo/google-ads-api) (MIT, bên thứ ba) thay vì đổi backend; tham chiếu SDK Google chính thức và [Meta Node SDK](https://github.com/meta/facebook-nodejs-business-sdk) cho auth/schema/error/version; học dataLayer queue semantics từ Google, checklist từ marketingskills và durability từ Trigger.dev. Không SDK nào tự tối ưu ROAS; dataLayer helper không chứng minh event receipt, MMM không thay attribution từng campaign. Ma trận nguồn ghi phần áp dụng/nghiên cứu/không chọn cùng license, không thêm dependency ở các đợt đầu.

| Hiện trạng cần giữ | Dẫn chứng đã đọc | Kết luận được phép |
|---|---|---|
| Next 16/React 19/TS, file store, quality gate | `CLAUDE.md:3`, `CLAUDE.md:11`, `docs/ARCH.md:29` | Reuse stack, evidence, atomic file write/lock; không dựng framework mới |
| Briefing có evidence, blocked/fallback, history | `docs/ARCH.md:33`, `docs/ACCEPTANCE.md:5` | CODE + TEST-HISTORY; authenticated UI/runtime chưa đóng gate |
| Startup env thắng saved settings; admin save cập nhật process.env | `lib/settings/saved-credentials.ts:52`, `app/api/settings/google/route.ts:57` | Có bất nhất provenance giữa process đang chạy và restart; chưa xác minh root cause host |
| Google test kiểm ít nhất một customer; kết quả có accounts | `app/api/settings/google/test/route.ts:43`, `app/api/settings/google/test/route.ts:83` | Không đồng nhất route này với mọi debug/health; zero campaign khác zero accessible account |
| Hộp việc đã gom và xếp hạng nhiều nguồn | `lib/inbox/build.ts:20`, `lib/inbox/build.ts:215` | Mở rộng luồng hiện tại, không tạo Inbox engine song song |
| Jobs có schedule descriptor, history, heartbeat | `lib/jobs/registry.ts:6`, `lib/jobs/store.ts:99`, `lib/jobs/heartbeat.ts:29` | Registry không chứng minh scheduler đang chạy hoặc notification đã giao |
| Tag Doctor biết cấu hình/đếm và đề xuất sửa | `lib/measure/tag-doctor.ts:55`, `lib/measure/tag-doctor.ts:285` | GTM tồn tại/fired không chứng minh platform nhận hay attribution đúng |
| Observation lưu assessment mà không đổi claim/quota/outcome | `lib/automation/approval-store.ts:100`, `app/api/automation/approvals/observe/route.ts:6` | Đã có boundary chỉ đọc provider; hiện giới hạn Google/đơn vị đã xác minh |
| SQLite authority/claim/quota có transaction | `lib/automation/execution-coordinator.ts:209`, `docs/NEXT-EXECUTION-PLAN.md:365` | Atomicity nội bộ SQLite; không phải atomicity approval JSON ↔ SQLite ↔ provider |
| Live stored apply đang hard-block | `lib/automation/approval-store.ts:65`, `docs/NEXT-EXECUTION-PLAN.md:370` | Trusted ingestion/provenance/live wiring chưa có; không gỡ guard bằng flag |
| Attribution ghép lead/order, chưa binding provider campaign đáng tin | `lib/attribution/report.ts:10`, `docs/ACCEPTANCE.md:74` | Click ID nối lead-order không tự thành campaign revenue; label không phải campaign ID |
| MBC revenue, MBI paid orders qua Report API | `lib/finance/company-pnl.ts:29`, `lib/finance/company-pnl.ts:213` | Không thay MATBAO_REPORT_API bằng ODOO_URL, không giả host mặc định |
| MBI bảy customer_source, notify chỉ 29 | `lib/mbi-order-sources.ts:33`, `lib/mbi-order-sources.ts:93` | [17,29,16,19,27,243,30]; giữ team/type/payment/date filters |
| Creative và Business Profile đã có | `lib/business-profile/registry.ts:46`, `lib/creative-brief/builder.ts`, `components/creative/BriefBuilder.tsx` | Tái sử dụng profile/brief/draft, chưa gọi là vòng experiment hoàn chỉnh |
| Remote runtime/storage chưa xác minh | `docs/BETA-RUNTIME-VERIFICATION.md:5` | URL được ghi nhận không xác lập isolation, image, mount, replica hay commit hiện chạy |

TEST-HISTORY: `docs/ACCEPTANCE.md:44` ghi 19 route tests và các mock boundary; các delta sau đó phải đọc theo ngày.
`docs/NEXT-EXECUTION-PLAN.md:371` ghi authority 290 PASS/71 skipped; `:377` ghi MBI 302 PASS/71 skipped, không phải số vừa chạy lại.
Security cũ trong MASTER ghi critical/high; delta authority ghi HIGH/CRITICAL gate pass, 14 moderate. Cả hai là lịch sử, phải đo lại khi release.
DEPLOY-RECORDED: commit `723d12a` ghi successful seven-source release build; evidence main ghi bảy nguồn đã release. Không suy ra authenticated browser mọi gate trên commit đó.
PUBLIC Noti, license GitHub và phạm vi dùng được phân biệt ở tài liệu nguồn; không khẳng định tương đương tính năng hoặc ROI.

## 3. Goal — một câu

Giúp người vận hành AdsCommand phát hiện vấn đề từ dữ liệu đáng tin, xử lý có người duyệt và quan sát kết quả có bằng chứng mà không tạo quyết định tiền hoặc hành động từ AI.

## 4. Constraints

1. Lượt này chỉ viết docs; không code/build/test runtime/deploy/provider/DB/config, không stage/commit/push, không sửa NEXT.
2. Additive-first, reuse-first; không framework/multiagent/dependency/service mới mặc định; mọi task triển khai đọc guide Next trong `node_modules/next/dist/docs/` trước code.
3. Unknown/unavailable/stale/partial/ambiguous không thành số 0, pass hoặc màu thành công; real zero phải có complete read.
4. Evidence luôn có company/provider/account/campaign khi áp dụng, source, range, readAt, completeness, currency/tz, provenance/version.
5. AI chỉ tóm tắt/giải thích/soạn nháp; rule deterministic và người có quyền chọn hành động, mục tiêu và số tiền.
6. Auth/company scope kiểm server-side; secret chỉ server, mã hóa tại nơi lưu hiện có, không vào prompt/log/ảnh/report; không copy raw provider response.
7. Supervised trước; không blind retry provider write; unknown sau write phải đối soát; không tự bật legacy write jobs.
8. Một beta chung, không tự suy host/volume; rollout/rollback giữ dữ liệu, không down -v/prune; staging phải thực sự tách production.
9. Profit chỉ khi BA duyệt nguồn/công thức; revenue/order/pacing không cần COGS. Không gán doanh thu nền tảng thành doanh thu đơn thật.
10. Giữ lịch sử kế hoạch, dùng ID ACU cục bộ; không tuyên bố đã tạo task Factory hoặc acceptance đã pass.

## 5. Scope A–E

**A. Domain model:** audit model hiện có trước; bổ sung provenance credential, layered health, evidence refs, workflow/observation, run/delivery ledger, attribution binding, experiment revision khi có consumer UI.
**B. Service/Engine:** reuse saved credentials, connector checks, Tag Doctor, Inbox rank, briefing gate, jobs, forecast quality, matcher, coordinator, provider clients, profile/creative builders.
**C. API:** giữ route/auth/error convention hiện có; contract mới phải version/validate, có source status và lỗi public sạch; đọc drill-down trước, ghi chỉ phase 7 sau gate.
**D. UI:** mở Settings Health/Tracking, Đo lường, Việc hôm nay, Automation Decisions/History, Budget Pacing và Creative; tránh một dashboard trùng lặp.
**E. Tests:** unit rule, integration handler + store thật ở boundary cần kiểm, regression invariants; browser read-only/screenshot UI; runtime/provider write drill là gate riêng được main/ops điều phối.

## 6. Audit Before Build

Mỗi mini-spec ACU phải ghi audit hẹp ngay trong record của task: view/API/state nào đọc, gap nào xác nhận, file/line, evidence class và consumer nhận kết quả.
Không áp luật riêng audit-ads ở mục 13 playbook sang AdsCommand; dùng grammar v2, guardrail của repo này và quyền user hiện tại.

| Gap | Loại | Audit cần hoàn tất trước task | Cách xử lý |
|---|---|---|---|
| Save chạy được nhưng restart invalid_client | data/config/observability | startup, encryption key identity, saved file path, env origin, volume/deployment metadata | P1; không đoán stale env là nguyên nhân duy nhất |
| Health/debug báo ok khi zero account (main ghi nhận) | vocabulary/API/UX | trace đúng endpoint/UI và scope thực tế; đối chiếu Google test có guard | P1; không sửa nhầm route |
| GTM fired/screenshot Names bị hiểu là resolved | evidence/UX | ảnh tag + Variables Values đã che nhạy cảm; consent/network/receipt | P2; chưa đủ → chưa xác minh |
| Inbox/brief/job có nhưng thiếu vòng đóng việc | state/UX | khảo sát consumer, dedup, route và stores hiện hành | P3–5; chỉ thêm trạng thái thiếu |
| Attribution không có binding campaign | data/permission | authoritative source fields, completeness, paid orders/filter contract | P6; label match không thay binding |
| Coordinator chưa trusted ingestion/live runtime | architecture/security | JSON sources, authority registration, Node SQLite/mount/replica | P7; giữ hard guard |
| Profile/creative có nhưng hiệu quả chưa so sánh được | domain/UX | identity/version, approval, experiment tracking hiện có | P8; không thêm generator song song |

## 7. ONE Design Choice

Chọn **modular monolith Next.js hiện có, deterministic evidence workflow, người duyệt trên web, jobs hiện có và persistence theo từng boundary**.
Luồng chung: source → normalize/evidence → health/rules → Inbox/brief → người xem → observation → outcome; provider apply chỉ là nhánh có gate riêng.
File JSON tiếp tục dùng cho read-only bounded history nơi phù hợp; coordinator SQLite là authority cho execution khi phase 7 hoàn tất trusted ingestion.
Không đồng bộ dual-write JSON/SQLite rồi gọi là transaction: authorization/consume/claim/quota phải cùng authority, JSON chỉ projection được rebuild, có reconciliation/outbox nếu cần.
Chưa chọn Trigger.dev service, Python SDK backend, Meridian runtime hay multiagent: thêm chi phí vận hành trước khi chứng minh giá trị UI không giải quyết gap hiện tại.
Không xây toàn bộ backend trước giao diện: từng phase chỉ đóng khi người dùng đi hết scenario và thấy bằng chứng.

## 8. Tám phase và release slices

Mọi đường dẫn ghi **NEW** là target đề xuất, phải đối chiếu tồn tại ở audit triển khai; không khẳng định đã có.
Cột UI/API/job/schema dưới đây là deliverables thiết kế; job “không thêm” vẫn phải audit ảnh hưởng jobs cũ.
Mỗi flag `ACU_Pn_ENABLED` bên dưới là **PROPOSED, mặc định OFF**, chỉ kiểm soát capability mới; không tắt chức năng hiện dùng hay thay hard guard.
Rollback chung: tắt flag/job mới, về UI/reader tương thích, giữ evidence/audit và dữ liệu; không hoàn tác credential tốt bằng config lỗi cũ.

### P1 — Credential bền vững và health trung thực (P0)

**Scenario:** admin lưu Google hợp lệ, mở lại ứng dụng sau restart và thấy đúng cấu hình có hiệu lực; người vận hành biết lỗi auth hay thiếu quyền account.
**Goal:** cấu hình đã lưu giữ hiệu lực qua restart hoặc giải thích chính xác vì sao không thể dùng.
**Reuse:** `lib/settings/saved-credentials.ts`, `lib/settings/env-origin.ts`, `lib/crypto/data-encryption.ts`, `app/api/settings/google/route.ts`, `app/api/settings/google/test/route.ts`, `components/settings/ConnectorHealth.tsx`, `lib/connectors/health-store.ts`.
**A/schema:** NEW `lib/settings/credential-provenance.ts`: version, provider/company, origin env/settings, revision, updatedAt, keyId/fingerprint không đảo ngược và test status; không lưu secret lần hai.
**B/service:** resolver có managed-env mặc định tương thích; settings-managed chỉ sau migration rõ ràng từng connector; save không được nói active nếu startup sẽ dùng giá trị khác.
**C/API:** mở rộng GET settings bằng masked effective origin/revision/restart behavior; POST trả saved/effective/conflict; không trả plaintext secret. Trace và sửa đúng health/debug route tìm được qua audit.
**D/UI:** Settings hiển thị nguồn hiệu lực, xung đột env/settings, trạng thái auth/account permission/data access và hướng xử lý; zero enabled campaigns vẫn có thể là account đọc được.
**Job:** không thêm; invalidate connector caches có kiểm soát, không bắn lại toàn bộ cron.
**Migration/compat:** inventory path và legacy field casing; backup encrypted file + key reference ở vault hiện có; dry-run mapping; không ghi đè khi decrypt fail; giữ rollback reader v1.
Chính sách precedence mới phải opt-in theo connector, xác nhận managed env với ops; không flip toàn bộ env ưu tiên. Không đổi key/path trước kiểm restore và restart.
**Dependencies:** code repro làm ngay; runtime cần metadata/target đúng và secret qua cơ chế hiện có, không qua chat.
**Acceptance/tests:** [ ] ACU-1a save → fresh child process → cùng effective revision; [ ] ACU-1b stale env conflict thấy được, không silently đổi nguồn.
[ ] ACU-1c missing/wrong key, corrupt file, unwritable path, missing mount không mất credential cũ; [ ] ACU-1d zero account/permission/auth fail không healthy, valid account zero campaigns không false fail.
[ ] ACU-1e response/log/audit không lộ secret; scope company bị chặn trước provider. Unit resolver + integration encrypted temp store/fresh process + regression health; restart/redeploy staging riêng mới là runtime acceptance.
**Rollout/rollback:** flag P1 cho provenance/resolver mới OFF; hotfix health trung thực review riêng; canary một connector, giữ file version tương thích, rollback reader không xóa data.
**Trách nhiệm đề xuất:** backend/settings + QA; ops xác nhận storage/key lifecycle; security rà secret boundary.

### P2 — Connection + Tracking Health có lớp bằng chứng

**Scenario:** marketer thấy Google/Meta/GA4/GTM kết nối được nhưng Purchase chưa xác minh receipt, rồi mở đúng checklist để thu thêm bằng chứng.
**Goal:** không nhầm cấu hình hoặc tag fired với nền tảng nhận sự kiện và đơn hàng được attribution.
**Reuse:** `components/health/*`, `app/(dashboard)/settings/health/page.tsx`, `app/(dashboard)/settings/tracking/page.tsx`, `app/(dashboard)/do-luong/page.tsx`, `lib/measure/{tag-doctor,gtm,gtm-api,google-health,meta-health}.ts`, `app/api/measure/{health,tags}/route.ts`.
**A/schema:** NEW `lib/measure/evidence-contract.ts` cho configured/authenticated/readable/fresh, tag configured/fired, request sent, platform received, business reconciled; missing là unknown, không đổi ngầm enum cũ.
**B/service:** map evidence với source/time/range, consent, event ID/name, value/currency và dedup; chỉ retain metadata đã che dữ liệu cá nhân.
**C/API:** mở health/tags trả từng layer + evidenceRef/limits/nextCheck; manual evidence chỉ role được phép, không biến ảnh thành signed platform receipt.
**D/UI:** ma trận Connection + Tracking trong màn hiện có; checklist tag, consent, request, platform test/diagnostic, rồi paid orders; có liên kết nguồn thay badge “đã tốt” chung.
**Job:** reuse measure monitor read-only; chưa tăng cadence ở phase này. Schema append-only evidence refs bounded, không lưu browser session/cookie.
**Dependencies:** P1 về effective auth; layer UI có thể thiết kế với fixture gắn nhãn trước khi ops mở runtime.
**Acceptance/tests:** [ ] ACU-2a GTM fired nhưng không receipt → unconfirmed; [ ] ACU-2b screenshot Variables **Names** không được coi là resolved Values.
[ ] ACU-2c blocked consent, duplicate browser/server event, wrong currency, platform delay và partial API mỗi trường hợp có lý do; [ ] ACU-2d stale/cross-company evidence không pass.
[ ] ACU-2e TikTok chỉ checklist/read-only đến khi có authorization/API scopes/test target; không đề xuất write sớm.
Unit state mapping + integration health failures/redaction + UI matrix. Browser/screenshot acceptance chỉ đọc; thao tác gửi event thật ngoài scope automation ảnh.
**Rollout/rollback:** P2 OFF; bật trên read-only company pilot, rollback panel cũ và giữ evidence, không publish GTM/đổi goals trong rollout health.
**Trách nhiệm:** tracking engineer/backend + frontend + QA; BA duyệt tên layer và checklist nghiệp vụ.

### P3 — Action Inbox và daily brief có thể dùng ngay

**Scenario:** mỗi sáng người dùng mở Việc hôm nay, thấy việc sửa số đo trước cơ hội tối ưu, mở evidence, giao nhận/hoãn và xem brief cùng dữ liệu.
**Goal:** biến các chẩn đoán có sẵn thành danh sách công việc giải thích được, không sinh thêm hành động ngân sách bằng AI.
**Reuse:** `lib/inbox/{build,store,job,labels,localize,template}.ts`, `app/api/inbox/route.ts`, `app/(dashboard)/viec-hom-nay/page.tsx`, `lib/morning-briefing.ts`, `lib/morning-briefing-history.ts`, `app/api/automation/morning-briefing/route.ts`.
**A/schema:** bổ sung evidenceRef, source freshness, checklistVersion, acknowledged/snoozed/observing/resolved với audit actor/time; audit vocabulary cũ trước thêm enum.
**B/service:** reuse rank/dedup; “tiền liên quan” phải giữ nghĩa từng nguồn, không gọi là tiết kiệm bảo đảm; tách nguồn thiếu khỏi không có vấn đề.
**C/API:** mở GET inbox detail/status; NEW `app/api/inbox/[id]/status/route.ts` cho acknowledge/snooze có RBAC, revision/409; không apply provider.
**D/UI:** một hàng có vì sao, nguồn, việc nên kiểm, trạng thái, owner-role và link; brief top việc không đẻ số liệu hay budget/action mới.
**Job:** reuse `inbox_build`, `inbox_digest`, briefing; schema workflow additive có retention, tránh mỗi refresh tạo việc mới.
**Dependencies:** P2 health semantics; có thể phát hành với nguồn chưa có evidence ghi rõ unavailable.
**Acceptance/tests:** [ ] ACU-3a nguồn critical lỗi → brief blocked/explicit fallback, không gọi AI để suy số; [ ] ACU-3b lặp build không nhân đôi việc.
[ ] ACU-3c acknowledge không resolve; snooze hết hạn hiển thị lại; concurrent update trả conflict; [ ] ACU-3d company denial/partial/stale có UI riêng.
Unit ranking/checklists + route/store integration + regression briefing privacy/history; pilot đọc được top việc và mở evidence trên màn 375px.
**Rollout/rollback:** P3 OFF, canary Inbox read-only trước status actions; rollback UI mới, giữ trạng thái/audit, không xóa briefing history.
**Trách nhiệm:** product/BA chốt ý nghĩa ưu tiên; frontend/backend + QA; marketer xác nhận scenario.

### P4 — Observation end-to-end và vòng khép kín chỉ đọc

**Scenario:** người vận hành ghi nhận đã xử lý bên ngoài, đọc snapshot mới, so với baseline rồi theo dõi ngày 3/7; chưa đủ evidence thì việc vẫn đang quan sát.
**Goal:** nối đề xuất → hành động được ghi nhận → quan sát → kết luận mà không giả đã apply qua AdsCommand.
**Reuse:** `lib/automation/{approval-store,reconciliation,snapshot-store,snapshot-consumer,evidence-labels}.ts`, `app/api/automation/approvals/observe/route.ts`, `app/(dashboard)/automation/{decisions,history}/page.tsx`, `lib/search/split-tracking.ts`.
**A/schema:** NEW `lib/automation/workflow-observation.ts`: external-action record riêng, baseline/source refs, actor, actionAt, checkpoint 3/7, result/inconclusive + confounders; không tạo fake consumed approval để đi qua observe route.
**B/service:** reuse resolver/time/unit checks; observation không thay execution outcome/claim/quota; Google-only path cũ giữ giới hạn, Meta observation mới phải qua unit/scope contract riêng.
**C/API:** giữ observe endpoint hiện hành cho approval đúng điều kiện; NEW `app/api/automation/observations/route.ts` nhận reference, không nhận metric làm authority; GET lịch sử sanitized theo company.
**D/UI:** timeline một việc: proposed/externally recorded/observed/outcome; ghi rõ thực hiện ngoài tool và chưa xác minh; đường quay về Inbox.
**Job:** checkpoint chỉ đọc qua jobs khi P5 bật; trước đó manual refresh có throttle. Schema bounded observations, immutable baseline/version, không raw response.
**Dependencies:** P3 workflow và snapshots hiện có; không chờ live provider apply. KPI attribution phụ thuộc P6 thì outcome đó hiện inconclusive.
**Acceptance/tests:** [ ] ACU-4a đi hết Inbox → record → snapshot → assessment → timeline, provider mutation count bằng 0.
[ ] ACU-4b stale/pre-action/future/duplicate/non-newer snapshot và khác scope/currency/budgetKind bị chặn; [ ] ACU-4c ngày 3/7 chưa đủ mẫu trả inconclusive, không positive giả.
[ ] ACU-4d manual edit, promo, holiday, tracking change, delayed attribution được lưu confounder; before/after không gọi causal lift.
Unit reconciliation/outcome + integration route-to-temp-store thật + regression quota/outcome không đổi; browser automation chỉ đọc detail/timeline.
**Rollout/rollback:** P4 OFF; external record không nhập vào execution authority; rollback viewer, giữ baselines và observations.
**Trách nhiệm:** backend/analytics + frontend + QA; BA định nghĩa outcome/điều kiện so sánh.

### P5 — Monitoring durable và thông báo có kiểm soát

**Scenario:** người trực biết lần kiểm cuối thực sự chạy lúc nào, nguồn nào lỗi, thông báo đã gửi hay thất bại, rồi mở deep link read-only vào việc.
**Goal:** monitoring còn truy vết được sau restart, không bỏ sót hay gửi trùng im lặng.
**Reuse:** `lib/jobs/{registry,runner,store,heartbeat,tick,catchup,cron-guard}.ts`, `lib/monitor/measure-monitor.ts`, `lib/job-health-alerts.ts`, `lib/inbox/template.ts`, `lib/telegram.ts`, `app/api/cron/{measure-monitor,inbox-digest,job-health-monitor}/route.ts`, `components/health/JobsHealthTable.tsx`.
**A/schema:** NEW `lib/jobs/delivery-ledger.ts`: runId/scheduledAt/lease/checkpoint, dedup key, attempt, delivery status, nextAttemptAt; payload normalized bounded, không secret/webhook URL.
**B/service:** audit durable lock hiện có trước thêm; lease expiry/restart recovery/overlap guard; retry có jitter/cap cho read và notification có idempotency, không tái chạy provider writes.
**C/API:** mở jobs detail/history bằng last started/finished/next/stale và delivery sanitized; tách scheduled/actually running/delivered; admin-only retry notification theo ledger.
**D/UI:** Jobs/Health drill-down, delivery failed và recovery; daily digest dùng cùng Inbox snapshot, link phải đăng nhập và kiểm company.
**Job:** cadence theo quota/nguồn, không mặc định 15 phút; quiet hours, alert dedup/cooldown/escalation; per-company fairness, timeout/concurrency và retention caps.
**Dependencies:** P1 storage, P3 consumer, P4 checkpoints; outbound channel phải được owner cấu hình/chọn trước pilot send, UI/log-only không bị chặn vì thiếu webhook.
**Acceptance/tests:** [ ] ACU-5a kill/restart giữa run không tạo duplicate logical result; [ ] ACU-5b missed schedule hiện stale, không healthy vì có cron descriptor.
[ ] ACU-5c 429/network/delivery timeout retry bounded, ledger giữ uncertain; [ ] ACU-5d secret/PII/cross-company không vào message/link; closed/disabled company không chạy.
Integration scheduler/ledger fake clock + real temp store, crash recovery, duplicate delivery simulation; staging proof heartbeat và receipt cần ghi riêng, không suy từ mock.
**Rollout/rollback:** P5 OFF, log-only → một channel read-only; tắt schedule/delivery mới, giữ ledger/dedup; không restart stack hoặc bật legacy mutation cron để thử monitoring.
**Trách nhiệm:** backend/ops + QA; business owner chọn channel/quiet hours; security rà outbound.

### P6 — Pacing không phụ thuộc profit và attribution source contract

**Scenario:** MBC xem doanh thu và chi, MBI xem đơn đã thu tiền và chi; dự báo thiếu mẫu vẫn có số thực; campaign chưa map thì không có ROAS đơn thật giả.
**Goal:** cho phép đọc pacing hữu ích đồng thời giữ attribution đúng nguồn và đúng phạm vi.
**Reuse:** `lib/{forecast-quality,spend-forecaster,campaign-revenue,mbi-order-sources}.ts`, `lib/finance/company-pnl.ts`, `lib/attribution/{matcher,report}.ts`, `lib/orders/sources.ts`, `app/api/google/toolkit/budget-pacing/route.ts`, `app/(dashboard)/toolkit/budget-pacing/page.tsx`, `app/api/attribution/report/route.ts`, `app/(dashboard)/reports/attribution/page.tsx`.
**A/schema:** NEW `lib/attribution/source-contract.ts`: exact company/provider/account/campaign/range, authoritative binding reference/version, readAt nullable, source status/completeness, unique-order denominator, matched/unmatched, nullable revenue/orders/currency/coverage.
**B/service:** audit empty-array failure sources và duplicate denominator trước wire; chỉ available complete read mới có zero. Zero denominator → coverage null; platform conversion value tách khỏi business revenue.
**C/API:** mở attribution report bằng source contract; NEW campaign aggregate endpoint chỉ khi có binding thực và UI consumer, không dựng helper luôn unavailable rồi coi hoàn tất.
**D/UI:** pacing phân biệt account balance/campaign budget/internal KPI, observed days/projection/confidence; attribution hiển thị unmatched/ambiguity/data gap; MBC revenue và MBI paid-order labels rõ.
**Job:** reuse read collectors/cache, không đẩy offline conversions; schema binding cần BA/source owner xác nhận, không tạo mapping từ tên campaign hoặc product label.
**Dependencies:** P1/P2 freshness; pacing hiện có hoàn thiện độc lập, attribution activation chờ nguồn đủ; profit chưa đủ không chặn phần này.
**Acceptance/tests:** [ ] ACU-6a ít mẫu → projection null/insufficient, real zero khác unavailable; [ ] ACU-6b shared budget, micros/minor units, mixed currency/tz không so sai.
[ ] ACU-6c MBI đúng [17,29,16,19,27,243,30], notify vẫn [29], team/type/payment/date giữ nguyên; [ ] ACU-6d duplicate/ambiguous/cross-company/out-of-range không attributed.
[ ] ACU-6e nguồn lỗi/parse lỗi không [] như complete zero; coverage tính trên unique eligible orders; campaign binding thiếu không approvable.
Unit forecast/matcher + source-failure regression + route/store integration; runtime đối chiếu aggregate với nguồn cùng kỳ, không xuất dữ liệu định danh.
**Rollout/rollback:** P6 OFF theo capability, pacing read-only trước; attribution độc lập OFF đến verified contract; rollback reader compatible, giữ binding version và snapshots, không reset orders.
**Trách nhiệm:** data/backend + BA/source owner xác nhận contract; frontend + QA đối chiếu.

### P7 — Approval và supervised apply tận dụng coordinator

**Scenario:** người có quyền xem evidence/diff, duyệt một thay đổi trong phạm vi test đã xác nhận; tool ghi đúng một lần, đọc lại và đưa uncertainty sang đối soát.
**Goal:** thực thi một hành động người đã duyệt với authority, quota và bằng chứng vận hành đầy đủ.
**Reuse:** `lib/automation/{execution-coordinator,policy,approval,approval-store,execution-reservations,provider-apply,decision-audit,snapshot-consumer}.ts`, `components/settings/EvaluatorPolicyPanel.tsx`, `app/(dashboard)/automation/decisions/page.tsx`, existing Google/Meta clients.
**A/schema:** reuse SQLite authorization/policy/source/claim/quota/outcome tables; JSON approval là legacy/projection. NEW `lib/automation/trusted-ingestion.ts` và migration versioned đề xuất, không tự import JSON thành trusted authority.
**B/service:** authenticated server ingest kiểm provenance/ownership/current revision/source TTL; authority issue/revoke và claim có transaction; outbox/projection reconciliation để crash không tạo authority giả hay replay.
**C/API:** audit routes decisions/approve/revoke/apply; chỉ nhận server reference, không trust client metric/receipt; NEW runtime executor adapter targets sau contract review, không endpoint đăng ký authority tùy ý.
**D/UI:** dry-run → before/after diff → xác nhận có phạm vi → apply → read-back → audit → outcome; quyền xem/duyệt/ghi tách server; conflict và needs_reconciliation có hướng xử lý, không nút retry write mù.
**Job:** supervised manual execution trước; monitor/observe chỉ đọc. Quotas theo company/currency/day/run và count/absolute delta; global/company/provider/campaign kill switch recheck sát write, không pooling currency.
**Dependencies:** P1 durability, P4 reconciliation, P6 source phù hợp action, policy limits/actor roles được duyệt; runtime Node/SQLite/bundle/replica/mount/backup và target test rõ. Meta live test + beta management access hiện deferred.
Giữ `EXECUTION_COORDINATION_UNVERIFIED` đến khi trusted ingestion, runtime và integration đạt; không đổi env/boolean để bỏ guard. Existing profit evaluator vẫn fail-closed; policy non-profit cần spec rõ, không xóa guard profit để mở write.
**Acceptance/tests:** [ ] ACU-7a JSON giả/stale authority/policy superseded/source invalid/approval revoked/expired/cross-company bị chặn trước provider.
[ ] ACU-7b concurrency hai approvals cùng campaign, revoke-vs-claim, quota rollback, crash trước/sau claim, restart/replay chỉ một quyền ghi; JSON-SQLite crash không tái cấp quyền.
[ ] ACU-7c staging adapter read-before-write/one write/read-back/undo, unknown timeout → reconcile read-only không nhả quota; receipt provenance phải do executor tin cậy, không do client.
[ ] ACU-7d manual change sau apply → undo conflict; shared/adset budget không dùng campaign semantics; units/currency verified; mọi kill switch và quota thật có drill.
Mock adapter PASS chỉ chứng minh orchestrator; runtime acceptance riêng phải ghi đúng target/commit và quyền. Browser automation chỉ đọc approval UI, không click confirm/apply hoặc gửi thông báo.
**Rollout/rollback:** P7 OFF và hard guard giữ; staging test → supervised một scope approved → review; kill switch dừng writes/claim mới, reconcile claims tồn, giữ DB/audit; undo chỉ có quyền và precondition, không xóa volume.
**Trách nhiệm:** backend + security + QA; BA/policy owner duyệt limits/roles; main/ops thực hiện runtime/deploy/provider actions đúng quyền, không giao worker ghi production.

### P8 — Creative, Business Profile, review và experimentation

**Scenario:** marketer chọn profile đã duyệt, dựng brief/creative có version, review claim trước dùng, tạo thử nghiệm và đọc outcome ngày 3/7 kèm giới hạn.
**Goal:** liên kết nội dung và thử nghiệm với mục tiêu kinh doanh mà không tự publish hoặc suy lift từ tương quan.
**Reuse:** `lib/business-profile/{types,registry,defaults}.ts`, `lib/creative-brief/{builder,store,compliance,product-resolver,tone-engine}.ts`, `lib/{creative-ai-draft-store,creative-scorer,creative-compare,creative-tracker}.ts`, `components/creative/{BriefBuilder,PreflightPanel}.tsx`, `app/(dashboard)/creative/brief/page.tsx`, `app/(dashboard)/automation/ab-testing/page.tsx`, `docs/marketing-playbooks/`.
**A/schema:** NEW `lib/experiments/registry.ts`: profile/creative revision, objective, hypothesis, assignment/unit, primary metric, baseline, minimum sample/window, stop rule, confounders, reviewer approval; reuse experiment stores nếu audit tìm thấy phù hợp.
**B/service:** versioned deterministic content/policy checklist, human review; experiment loại observational/A-B/holdout ghi rõ, không tự đổi target hoặc ngân sách.
**C/API:** mở creative brief/brand/draft contracts bằng revision/review; NEW experiments endpoints chỉ khi có UI, server scope/auth/conflict; không gọi launch-campaign endpoint từ luồng review.
**D/UI:** brief → evidence/source → review → experiment card → 3/7 outcome từ P4; claim/ràng buộc sản phẩm, ngôn ngữ và destination checks thấy được.
**Job:** reuse P5 checkpoint read-only; schema retention/aggregate kết quả, không giữ prompt/raw provider/PII trong lịch sử phân tích.
**Dependencies:** P3/P4; P6 cho business metric đúng; experiment cần BA duyệt giả thuyết/sample, chưa cần P7 nếu người thao tác bên ngoài và ghi nhận rõ.
**Acceptance/tests:** [ ] ACU-8a profile đổi không sửa ngược brief cũ; draft chưa review không thành approved; [ ] ACU-8b company/profile mismatch bị chặn.
[ ] ACU-8c thiếu baseline, sample, comparable attribution/window/currency hoặc có confounder → inconclusive; [ ] ACU-8d output AI không tự publish/choose money/action.
Unit compliance/revision/outcome + route/store integration + UI review regression; pilot read-only với dữ liệu có nguồn, không tuyên bố ad được duyệt chắc chắn.
**Rollout/rollback:** P8 OFF, review-only trước experiments; rollback viewer, archive experiment mới nếu dừng, giữ revisions và outcome, không undo ads bên ngoài tự động.
**Trách nhiệm:** BA/marketer/profile owner + frontend/backend/QA; legal/compliance review claim khi cần.

## 9. Domain checklists deterministic

Áp dụng trước mọi khuyến nghị; rule có version, input evidence, reason code và missing requirements. Không hardcode ngưỡng tùy hứng từ Noti/LLM.

| Domain | Checklist bắt buộc | Khi chưa đủ |
|---|---|---|
| Google Search | mục tiêu và conversion primary/secondary; brand/nonbrand; search-term/query coverage; negatives/match type; lost share budget/rank; bidding strategy; landing/consent; learning/change history | Không gọi mọi chi không có đơn là waste; thiếu query coverage/attribution thì chỉ đề nghị kiểm |
| Google PMax | campaign/shared budget; asset group/feed/product/URL expansion; brand exclusions; placement/channel evidence; conversion goals; learning; coverage report limitations | Không suy hiệu quả kênh từ aggregate; không áp Search keyword logic vào PMax |
| Meta leads | lead objective/event, form/landing, qualified/won stage/source, conversion location; CPL vs qualified CPA; learning/maturity; placement/frequency/creative | Lead không phải paid order; thiếu quality source không đề nghị theo doanh thu |
| Meta sales | campaign/adset budget, optimization event, purchase value/currency/dedup; click/view attribution window; learning/recent edits; business paid orders/refunds khi có | Không trộn view-through với click-only hoặc platform purchase với đơn thật |

Tất cả domain: cùng kỳ, timezone source/business và DST nếu có, currency/unit rõ, complete pagination, freshness, spend/sample tối thiểu do BA/policy duyệt.
Không so sánh các window/model attribution khác nhau; thiếu/noncomparable hiển thị lý do và dữ liệu cần bổ sung, không tự normalize bằng giả định.
Playbook marketing đã có là tài liệu; chỉ được gọi runtime checklist sau review/version/test và có consumer, không copy prompt đối thủ.

## 10. UI brief và hợp đồng trải nghiệm

**Brief:** tool vận hành nội bộ; người dùng marketer, analyst, người duyệt, admin/ops; ba việc: biết dữ liệu tin được, chọn việc có bằng chứng, kiểm kết quả.
Dữ liệu chính bảng/timeline/KPI/biểu đồ; stack hiện có Next/React/Tailwind/shadcn trên Base UI, Lucide, Recharts; vi+en, mật độ vừa-dày, giữ theme sáng/tối đang có.
Ràng buộc: không trang trí gây nhiễu, không dữ liệu mẫu giả thật, phạm vi company nhất quán; assumption vai trò chính thức chờ BA/RBAC mapping.

**Ba tham chiếu cấu trúc:** (1) màn Health/Việc hôm nay hiện có — nhất quán điều hướng; (2) shadcn/ui https://ui.shadcn.com/ — pattern table/dialog/evidence drawer; (3) Recharts https://recharts.org/ — pacing/time series có trục/đơn vị.
Đây là nguồn tham khảo UI, không lấy tài nguyên ngoài trong lượt này; kiểm license exact paths trước adoption. Không thay Base UI bằng Radix chỉ vì ví dụ tham chiếu.
**Tokens:** reuse `app/globals.css:13`, `:79`, `:103`: font system hỗ trợ dấu Việt, semantic background/foreground/primary/border, radius hiện có, spacing bội 4; không thiết kế palette/font mới.
**Components:** reuse `components/ui`, Health tables, PermissionGate, BriefingEvidencePanel, Lucide và Recharts hiện có; không thêm Tremor, chart engine, animation library hay ảnh stock.

| Surface | Nội dung chính | States bắt buộc và hành động tiếp |
|---|---|---|
| Connection/Tracking | layer health + source/time + next check | loading skeleton; empty chưa kết nối; error sửa kết nối; permission theo scope; partial nguồn nào thiếu; stale refresh; conflict credential revision |
| Inbox/Brief | ưu tiên → evidence → status/link | loading; empty không có việc với nguồn complete; error/partial nguồn; permission; stale; conflict status; blocked AI khác fallback |
| Observation/History | baseline → action provenance → checkpoints | empty chưa có observation; unavailable/partial; stale; permission; conflict duplicate/non-newer; inconclusive không success |
| Pacing/Attribution | actual → trend → coverage → detail | thiếu mẫu/null forecast; source failure không 0; partial/unmatched; stale; permission; conflict binding revision |
| Approval/Creative | evidence → diff/review → timeline | read-only permission; expired; revoked; conflict; partial evidence; stale preflight; disabled action nêu điều kiện; unknown write → reconcile |

Wording **[ĐỀ XUẤT — chờ BA duyệt]**: vi “Chưa xác minh nền tảng đã nhận” / en “Platform receipt unconfirmed”; vi “Đã ghi nhận, chưa xác minh kết quả” / en “Recorded; outcome unverified”.
Mọi câu mới vào `lib/i18n/messages/{vi,en}/...`, không rải literal; lỗi nói việc xảy ra, nguyên nhân nếu biết, bước tiếp, link; không lộ stack trace.
375px: card/column priority, evidence drawer toàn chiều rộng; 768px: bảng cột rút gọn; 1280px+: table/detail panel; không ép chart lớn gây tràn trang.
Keyboard: thứ tự tab, focus visible/return, dialog close/Escape, labels icon-only, table header/units; contrast AA 4.5:1 chữ thường/3:1 chữ lớn, reduced-motion, không dùng màu đơn độc.
Notification ban đầu chỉ read-only deep link, xác thực lại + company scope; không token/session trong URL. Approval qua message deferred: signed intent TTL ngắn, nonce dùng một lần, actor/channel binding, scope và re-auth server; không biến webhook thành quyền duyệt.
**Prompt triển khai UI sau này:** “Mở rộng surface đã nêu, dùng tokens/components hiện có, chỉ dữ liệu có evidence; đủ bảy trạng thái, i18n chờ BA, keyboard và 375/768/1280; không gọi mutation qua screenshot test; báo đã kiểm/chưa kiểm.”
Rủi ro: icon/chart density, tiêu đề có dấu, bundle/performance và license tài nguyên mới; kiểm theo UI navigator mục 9, không tự thêm Storybook/axe dependency chỉ để làm đẹp báo cáo.

## 11. Test Plan và Definition of Done mỗi release

1. **Unit:** deterministic checklists, mapping state, credential precedence, zero/unavailable, units/tz/sample, outcome/confounders; không test chỉ mirror implementation.
2. **Integration:** real route/auth boundary với provider mock rõ nhãn; store/temp DB thật cho persistence/transaction; fresh process cho restart; không mock chính boundary đang cần chứng minh.
3. **Regression:** MBC/MBI filters, source privacy, blocked AI, company denial trước calls, snapshot TTL, approval revocation, claim/quota/replay và hard guard.
4. **Build checks khi triển khai:** focused Vitest → `npx tsc --noEmit` → scoped lint + GAQL check → build; full regression/security phù hợp release, ghi skipped và lỗi baseline riêng. Không chạy các lệnh này cho docs-only hôm nay.
5. **UI acceptance:** read-only browser automation và screenshots có session được cấp, fixture gắn nhãn, đủ states/viewport/keyboard; không click apply/send/publish. Screenshot không chứng minh provider receipt hay restart persistence.
6. **Runtime acceptance riêng:** ghi app/deployment commit/image, thời điểm, cấu hình target sanitized, isolation/storage/replica; restart drill và provider writes chỉ khi scope thật được xác nhận, main/ops thực hiện theo quyền.
7. **Security/dependency:** audit lại lockfile/production transitive, license/NOTICE/API versions, pin khi adoption; không dùng số audit cũ, force upgrade hoặc disable TLS. Public release cần vibe-sec và gate vận hành phù hợp.

Release DoD: acceptance IDs tương ứng có evidence artifact + ngày/commit/environment; consumer UI dùng được; API/schema compat; retention, rate/resource caps; rollback drill không xóa data; docs ARCH/API/TEST_LOG/ACCEPTANCE cập nhật theo delta thật.
Build/test PASS ≠ deployed ≠ runtime PASS. Chưa có runtime thì chỉ giao code-complete/read-only slice, không đóng gate runtime hay bật capability ghi.
Observable success: restart không đổi effective credential bất ngờ; health không báo tốt khi chưa có evidence; việc dẫn đến observation/outcome; job/delivery truy vết sau restart; thiếu attribution không sinh ROAS; write supervised không replay.
Không lấy số alert, số agent hoặc % hoàn thành làm thước đo thành công; pilot ghi scenario hoàn tất, lỗi/thời gian xử lý và giới hạn thực đo trước đặt SLA.

## 12. Rollout, vận hành và quyết định còn mở

Chuỗi phụ thuộc: P1 → P2 → P3 → P4 → P5; P6 pacing có thể làm sau P2, attribution contract song song P4/5; P7 chỉ sau source/runtime/policy gates; P8 review có thể sau P3, experiment sau P4/source phù hợp.
Không coi mọi nhánh deferred là blocker toàn cục. Mỗi phase có UI slice và flag OFF; pilot read-only trước, không tự bật limited/full auto sau khi test.
Ops kiểm README/DEPLOY, sổ ứng dụng, Coolify/Compose theo app/repo để xác nhận **beta chuẩn duy nhất**, owner/UI/API và storage thật; URL ghi trong runtime doc là đầu mối, không là kết luận host.
Không dựng backend/DB/Redis beta riêng cho UI. Preview frontend cần API beta có auth/CORS đúng, TTL tối đa 4h/watchdog + lệnh dừng; container `mb.env=preview`, owner, autostop=4, restart=no và CPU/RAM cap.
Beta dùng `mb.env=staging`, owner, restart=no, TTL mặc định 12h, resource limits; muốn liên tục cần phê duyệt vận hành, không tự longrun/production.
Số CPU/RAM/concurrency/quota cụ thể đo theo host/pilot trước enable, không bịa khả năng máy. Dừng preview/gỡ route khi xong; không xóa volume khi rollback/dọn bản dư.
Backup/restore cả encrypted credentials + key lifecycle + SQLite authority cần diễn tập ở staging đã xác nhận; volume mount tồn tại chưa chứng minh durable.

| Làm ngay trong đợt triển khai kế tiếp | Quyết định cần đúng vai trò | Deferred, không chặn toàn bộ |
|---|---|---|
| Repro credential/health bằng temp fixtures; inventory consumers | Ops: provenance policy managed-env/settings, beta metadata/storage/key refs | Beta management access và live Meta test chưa có scope |
| Thiết kế layered health/Inbox UI trên fixture gắn nhãn | BA: wording vi/en, ưu tiên KPI, sample/window/thresholds/outcome | Profit: nguồn COGS/refund + công thức BA; không chặn pacing |
| Audit attribution source, giữ unavailable khi thiếu binding | Source owner: binding company/provider/account/campaign, completeness/readAt | Message approvals, Zalo/voice, limited/full-auto |
| Review policy/authority trust boundary, giữ execution guard | Policy/security: RBAC, caps/cooldown/protected scopes; ops: write-test target/window | MMM/Meridian: optional nghiên cứu aggregate sau data quality/experiment |

MMM chỉ xem xét khi đủ lịch sử/geo/chi phí/kênh/control variables, calibration và năng lực causal review; resource/offline compute budget riêng được duyệt; không dùng LightweightMMM archived, không coi MMM là attribution đơn hay auto budget.
Không nhập competitor code/prompts/memory hoặc truy cập sản phẩm đối thủ. GitHub chỉ tham chiếu nguồn được cung cấp; dependency tối thiểu hiện tại là **không thêm**.

## 13. Ba task đầu tiên sẵn sàng bắt đầu và tracking

Các ID sau là ID trong plan, **chưa tạo AI Factory**. Mỗi task là một mini-spec hẹp theo playbook v2, không mở rộng sang deploy/write.

- [ ] **ACU-T01 / P1 — Repro save → fresh process và provenance.** Scope saved-credentials/env-origin/Google settings + temp-store tests; output audit gap, migration/compat spec và test failure tái hiện. Không đụng host. Xong khi phân biệt env conflict, decrypt/file failure và real auth rejection; map ACU-1a/b/c/e.
- [ ] **ACU-T02 / P1 — Trace false-positive health.** Trace đúng debug endpoint → connector health → UI; output source/error matrix và patch spec nhỏ, tests zero accessible accounts vs account zero campaigns. Xong khi có failure repro và ACU-1d acceptance đủ boundary; phụ thuộc T01 effective config contract, không cần beta access để làm fixtures.
- [ ] **ACU-T03 / P2 — Health evidence vertical slice.** Mở Tag Doctor/Health UI/API bằng layered contract, fixtures fired-without-receipt/Names-not-Values/permission/stale. Output mini-spec/UI state matrix và test map ACU-2a–e; không GTM publish/TikTok writes, không chờ P7.

Tracking phase: [ ] P1 ACU-1a–e; [ ] P2 ACU-2a–e; [ ] P3 ACU-3a–d; [ ] P4 ACU-4a–d; [ ] P5 ACU-5a–d; [ ] P6 ACU-6a–e; [ ] P7 ACU-7a–d; [ ] P8 ACU-8a–d.
Effort chưa ước lượng vì chưa audit task-level/runtime; khi bóc mini-spec có thể thêm khoảng effort **ước lượng lập kế hoạch, không cam kết deadline**, tách code/UI, QA và chờ ops/BA.

## 14. Báo cáo bắt buộc theo playbook mục 7

Mỗi mini-spec/release báo tám mục, có artifact và giới hạn thực tế:
1. **Summary:** scenario/outcome đã giao, phạm vi.
2. **Audit Before Build:** view/API/state đã đọc, gap xác nhận và source refs.
3. **Design Choice:** một hướng đã chọn và module tái sử dụng.
4. **Changed Files:** backend, frontend, migration FILE, docs; không giấu thay đổi cấu hình.
5. **New API/DB/State:** contract/version/compat, migration đã chạy hay mới viết.
6. **Tests:** lệnh và kết quả thật, counts/skips/ngày/commit, bug/fix, mock boundaries.
7. **Live Verification:** target/scope/commit/evidence hoặc PENDING với lý do; build/screenshot không thay runtime.
8. **Remaining Limits / Follow-ups:** quyết định BA/ops, deferred, rollback và task tiếp theo; không đóng acceptance thiếu evidence.

### Nhật ký thực thi ACU — cập nhật theo bằng chứng

- 26/11/2026: bắt đầu ACU-T01, lát cắt Google settings persistence/provenance. Test POST thực → tệp mã hóa tạm → process mới; giữ env-first, báo conflict, write-before-runtime, UI không coi save là auth success.
- Full regression 313 PASS / 71 skipped; sau sửa fixture NODE_ENV, TypeScript/core lint và 11 test durability PASS. Đây là local evidence, chưa runtime beta. Settings UI có lint effect lỗi từ baseline đã đối chứng, không tắt rule.
- T01 chưa đánh dấu hoàn tất: OAuth callback writer riêng còn follow-up; host storage/key lifecycle/redeploy chưa được xác minh. Không có credential/volume/provider mutation hoặc activation.

## 15. Hợp đồng triển khai tối thiểu để bóc mini-spec

Các field dưới đây là **PROPOSED**, không phải schema/API đang tồn tại; audit phải map sang type hiện có trước thêm.
Không ép mọi store về một schema lớn hoặc tạo generic workflow engine mới.

| Boundary | Input được chấp nhận | Output / invariant |
|---|---|---|
| Health read | company đã authorize; provider whitelist; range validate | layer, status, checkedAt/readAt, evidenceRefs, reasonCode, nextCheck; secret không serialize |
| Inbox status | itemId + expectedRevision + acknowledge/snooze + thời hạn bounded | revision mới, actor audit; 409 khi stale, không tự resolve |
| Observation | workflow/approval reference + registryId; actor từ session | assessment + evidence hash/readAt; metric client không authoritative |
| Attribution aggregate | company/range và provider campaign binding server-resolved | nullable totals/coverage, unique counts, denominator definition, completeness; không order identity |
| Approval/apply | decision/approval ID server-issued + expected revision + confirmation intent | preflight/diff hoặc execution reference; claim authority không lấy từ JSON client |
| Creative review | brief/draft revision + review verdict + scope | immutable reviewed revision, reviewer/time; edited draft phải review lại |

Quy ước lỗi đề xuất: 401 chưa đăng nhập, 403 sai scope/role, 400 input sai, 409 revision/binding/conflict, 429 throttle, 503 source/runtime unavailable.
Map theo convention route hiện hành khi audit, không thay error envelope toàn app trong một task.
Read-only GET không biến thành ghi provider; POST observation/status chỉ ghi workflow nội bộ theo quyền, phải phân biệt với provider mutation.
Mọi endpoint detail/history enforce scope trước đọc source; query string không là authority account/company.
Dữ liệu đầu ra có generation/source status và timestamps; không lấy thời điểm tạo response làm readAt của nguồn chưa đọc.

### Chốt giới hạn outcome và experiments

- Baseline khóa theo revision/time/range; actionAt khác observation readAt và checkpoint dueAt.
- Checkpoint ngày 3/7 dùng timezone/business calendar được BA chọn; job chậm không giả đã quan sát đúng hạn.
- Thu thập cùng metric/source/model window; late conversions cho phép kết luận revised với evidence mới, giữ kết luận trước.
- Positive/neutral/negative chỉ khi rule và sample đã duyệt; ngược lại inconclusive kèm missing requirements.
- Chỉnh tay ngân sách, đổi creative, đổi tracking, khuyến mãi và biến động mùa vụ là confounders, không xóa khỏi report vì kết quả đẹp.
- Holdout/A-B cần assignment và contamination check; observational before/after không được gọi incrementality.
- Stop rule không tự pause campaign; nếu muốn thao tác provider phải thành proposal riêng qua P7.

### Release gates theo phạm vi, không khóa toàn sản phẩm

| Release slice | Bằng chứng phải có trước enable | Việc được tiếp tục khi chưa đạt |
|---|---|---|
| P1 reliability | local restart regression; runtime restart proof trước tuyên bố đã sửa trên beta | P2/P3 UI spec và source audit trên fixtures |
| P2/P3 read-only experience | source mapping + privacy/auth tests + UI state acceptance | Pacing thực tế hiện có, không mở write |
| P4/P5 observation/monitoring | durable history/recovery, scoped links, channel consent/config trước gửi | Log-only workflow khi notification chưa cấu hình |
| P6 business attribution | binding/completeness/source acceptance cho đúng scope | Revenue/order totals và pacing không cần attribution campaign |
| P7 supervised execution | authority integration + runtime + approved test target + failure/undo drills | Toàn bộ luồng chỉ đọc và external-action observation |
| P8 experiments | reviewed profiles, comparable baseline/sample/metric và evidence | Creative review-only nếu chưa đủ experiment data |

Artifact mỗi gate có `planId`, acceptance IDs, source commit, deployment commit nếu có, command/scenario, time, target sanitized, outcome và reviewer role.
Không lấy screenshot đang đăng nhập làm bằng chứng secret persistence, scheduler delivery hay live mutation; không lấy Node local làm Node image remote.
Chưa có host metadata thì giữ runtime pending đúng phạm vi, không suy app đang chạy từ Compose file hoặc tên container gần giống.
