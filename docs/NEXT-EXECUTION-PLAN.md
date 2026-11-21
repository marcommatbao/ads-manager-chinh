# Kế hoạch thực thi tiếp — AdsCommand

Cập nhật: 2026-11-20. Tài liệu đánh giá theo bằng chứng, không dùng phần trăm tiến độ để suy ra khả năng chạy production.

## 1. Phạm vi đang thực hiện

Hoàn thiện automation deterministic trên nền Meta/Google đã có. Không xây lại connector, không bật mutation tự động và không thay đổi luồng auto-apply cũ khi chưa kiểm chứng.

## 2. Đã thực hiện trong working tree

| Hạng mục | Bằng chứng | Giới hạn |
|---|---|---|
| Policy server, validation, defaults OFF | Tests policy và dry-run | Một policy toàn hệ thống, chưa có phân tầng company/provider |
| Form Cài đặt Automation | TypeScript và production build của phần form pass | Chưa browser visual/keyboard/mobile |
| Lưu draft, actor server, revision conflict | Test store cô lập + sửa đồng thời | Lock trong một process; audit ghi intent trước khi ghi policy |
| Approval lưu server, so snapshot với dry-run server | Test auth/scope/tampering | Chưa gắn policy version/provider vào snapshot; chưa tự hết hạn decision snapshot |
| Claim một lần trước adapter | Test replay và concurrent claim | Chưa khóa theo campaign giữa các approval khác nhau |
| Apply mock + read-before-write + read-back | Test snapshot/budget/expiry/mismatch | Không phải provider runtime acceptance |
| Kết quả needs_reconciliation khi timeout/lỗi lưu | Test không retry, không lưu raw error | Chưa UI và quy trình xử lý đối soát |

Kiểm tra gần nhất: TypeScript PASS; 9 test files / 44 tests PASS; scoped lint PASS; diff check PASS. Production build trước đó PASS cho policy UI; cần build lại sau thay đổi approval/execution mới nhất.

## 3. Thứ tự còn lại

### A. Hoàn thiện nguồn decision và guardrails — ưu tiên P0

- Validation runtime đầy đủ cho request dry-run, không chỉ kiểm field tồn tại.
- Snapshot phải do server đọc từ client Meta/Google hiện có; số client gửi chỉ được dùng cho simulation và gắn nhãn simulation.
- Decision ID riêng, hash bao gồm giá trị nguồn, provider/account, company, policy revision và thời gian hết hạn.
- Kiểm tra tuổi dữ liệu, cùng kỳ, minimum observed days, confidence và quyền campaign/account.
- Không dùng công thức profit chưa duyệt để quyết định tăng/giảm ngân sách.

Đạt khi: stale/malformed/fake policy/cross-company đều bị chặn, và có test đi qua route thật với mock provider boundary.

### B. Approval lifecycle và concurrency — ưu tiên P0

- Approval chỉ tham chiếu decision ID server, không nhận toàn bộ decision làm nguồn tin.
- Ràng buộc provider/account/policy revision; policy đổi thì approval cũ vô hiệu.
- Lock theo provider/account/campaign, không chỉ approval ID.
- Hạn mức mỗi lượt/ngày và tổng budget delta; reserve trước ghi.
- Trạng thái durable: approved → claimed → applied/blocked/failed/needs_reconciliation.
- Quy trình approval hết hạn/thu hồi và cho phép tạo proposal mới có ID mới.
- Chặn apply nếu chưa xác nhận single-process hoặc chưa có transactional shared store.

Đạt khi: hai approval khác nhau cùng campaign không gây hai mutation đồng thời; restart sau claim không replay; quotas không vượt khi chạy đồng thời.

### C. Provider adapters và undo — ưu tiên P0

- Tận dụng client Meta/Google hiện có; adapter giới hạn account/company đúng phạm vi.
- Xác nhận đơn vị tiền/micros, daily/shared budget và cấp campaign/adset.
- Read-before-write, policy recheck sát mutation, read-back tolerance theo provider.
- Timeout sau write: đối soát read-only, không tự retry mutation.
- Undo chỉ khi current bằng applied value; không ghi đè chỉnh tay.

Đạt khi: adapter tests + staging read/write/read-back/undo với tài khoản test được xác nhận. Không ghi tài khoản chạy quảng cáo thật chỉ để thử.

### D. Automation Center — ưu tiên P1

- Hiển thị decisions, nguồn dữ liệu, before/after diff, policy revision.
- Queue approval, lịch sử, trạng thái thực thi và lý do block.
- Màn đối soát needs_reconciliation: đọc provider và ghi kết luận có quyền, không có nút retry ghi mù.
- Kill switch global/company/provider/campaign; audit actor và thời điểm.
- Đủ loading/empty/error/permission/conflict states, i18n, mobile và bàn phím.

Đạt khi: click-through browser trên bản build, không chỉ tsc; mock fixtures phải gắn nhãn test.

### E. Monitoring + outcome — ưu tiên P1

- Nối vào job registry hiện có; xác nhận lịch thực chạy, overlap/rate limit/dedup.
- Bắt đầu read-only với lịch phù hợp quota; không mặc định 15 phút cho mọi nguồn.
- Cảnh báo data stale, source lỗi, pacing, mismatch và quota.
- Đo sau 3/7 ngày: positive/neutral/negative/inconclusive; không gọi before/after là tác động nhân quả.

Đạt khi: có heartbeat, run history, delivery status, outcome đủ nguồn và thời gian.

### F. Release và bảo mật — ưu tiên P0, song song A–E

- Đo lại audit dependency, không dùng số cũ làm trạng thái hiện tại.
- Nâng từng nhóm dependency; kiểm tương thích Node/Vitest/Google Ads, test và build.
- Không vô hiệu TLS, không force peer graph chưa kiểm.
- So commit local/GitHub main/Vibe Host deployment; chỉ báo đã deploy khi xác nhận đúng deployment mới.
- Runtime acceptance sử dụng cấu hình thật của beta chuẩn, không suy thiếu credential từ workspace preview.

Đạt khi: security gate đạt, runtime acceptance và rollback đủ bằng chứng, owner phê duyệt rollout.

## 4. Phạm vi nghiệp vụ hiện tại và các gate tồn

- Doanh thu MBC: Report API base từ MATBAO_REPORT_API, không lấy ODOO_URL thay thế.
- Số đơn MBI: Report API count-sale-order-paid.
- Campaign đơn: sale.order.campaign_id → utm.campaign.
- Lead/opportunity, COGS và refund ledger riêng không thuộc yêu cầu dữ liệu Odoo hiện tại của user.
- Profit optimization là tùy chọn bị chặn đến khi có yêu cầu nghiệp vụ/nguồn và công thức được duyệt. Không bắt COGS làm điều kiện cho dashboard doanh thu/đơn hoặc pacing read-only.
- Gate 3/4/5 chưa có đủ browser/runtime evidence trong lượt này; không tự đóng.

## 5. Những gì cần user/owner quyết định ở thời điểm thích hợp

1. Account/campaign staging nào được phép test ghi; budget range, currency và thời gian test.
2. Ai có quyền duyệt thay đổi; mức tăng/giảm/cap/cooldown và protected campaigns.
3. Mục tiêu ưu tiên: doanh thu MBC, đơn MBI, CPL/CPA/pacing hay profit (profit chỉ khi có nguồn).
4. Business Profile: sản phẩm/USP/claim cấm/target; wording UI cần BA review.
5. Quyền GitHub/source deploy và trust CA hợp lệ nếu push/deploy bị chặn.

Không cần gửi token/password trong chat. Cấu hình qua cơ chế secret/admin hiện có.

## 6. Rollout

Read-only/simulation → dry-run dữ liệu server → approval → adapter staging → supervised giới hạn → theo dõi outcome → xem xét limited auto. Không tự bật full-auto hoặc deploy production trong quá trình hoàn thiện plan.

## Cập nhật: phân biệt simulation và dữ liệu server

- Đã thêm validation runtime cho snapshot client: kiểu số, budget dương, trạng thái nguồn, ngày hợp lệ, range có thứ tự và coverage 0–1.
- Dry-run dùng policy/limits phía server và ghi audit mode `simulation` cho số liệu client.
- Response đánh dấu `inputOrigin: client_simulation`, `approvable: false`.
- Approval từ chối record simulation; test xác nhận không gọi persistApproval.
- Chưa có collector snapshot authoritative mới từ Meta/Google trong luồng này. Cần nối read-only collector theo account/company và lưu decision ID trước khi cấp approval thật.
- Verification: TypeScript PASS, 9 files / 52 tests PASS, scoped lint PASS, diff check PASS. Chưa build lại sau thay đổi simulation boundary này.

## Cập nhật: collector Google read-only

- API GET `/api/automation/snapshot?provider=google&company=...&campaignId=...&from=...&to=...`.
- Auth/company scope được kiểm trước khi gọi collector. Account lấy từ cấu hình server, không nhận từ client.
- Collector kiểm tra customer/campaign trong response, currency, timezone, micros và số ngày quan sát. Shared budget được ghi nhãn riêng.
- Snapshot có hash ID và TTL 15 phút; hiện trả về response, chưa lưu registry snapshot hoặc nối evaluator authoritative.
- Conversion value của Google không được coi là doanh thu attribution Odoo. Snapshot `approvable: false`, liệt kê nguồn còn thiếu.
- Tests mock provider: 5 files / 25 tests PASS cùng regression simulation/approval; TypeScript, scoped lint và diff check PASS. Chưa kiểm live Google, browser hoặc build lại cho collector này.
- Kế tiếp: đọc Meta có account scope tương đương; lưu snapshot registry, ràng buộc provider/account/policy revision vào decision và approval; chỉ tạo decision approvable khi nguồn nghiệp vụ đủ.

## Cập nhật: collector Meta read-only

- API snapshot nhận provider=meta bên cạnh google.
- Meta kiểm tra account_id trùng cấu hình server và chỉ chấp nhận campaign có company match duy nhất (prefix hoặc quy tắc cấu hình); không dùng fallback MBC cho trường hợp không rõ.
- Token dùng Authorization header, không đưa vào URL; lỗi route được sanitize.
- Insights rỗng → spend null; phân trang chưa đọc hết → từ chối snapshot không đầy đủ. Budget giữ minor units từ provider, chưa giả định tỷ lệ đổi tiền.
- Verification: TypeScript, scoped lint, diff check PASS; 5 files / 26 tests PASS với mock provider. Chưa gọi Meta live.
- Còn lại: snapshot registry bền vững/TTL; company mapping Meta cần người quản trị xác nhận cho campaign không có nhãn; đơn vị budget; authoritative decision ID/policy binding; không có approval hoặc apply thật từ collector.

## Cập nhật: registry snapshot và binding policy

- Collector API lưu snapshot vào `data/automation-snapshots.json` bằng atomic write và process-local file lock; chỉ server collector gọi store.
- Mỗi record có registryId, company/provider/account/campaign/policyRevision, payloadHash, readAt/expiresAt.
- Resolver yêu cầu binding kỳ vọng từ cấu hình server hiện hành; từ chối sai binding, hash lệch, TTL hết hạn và TTL quá 15 phút.
- Policy đổi trong lúc đọc provider trả 409, không lưu snapshot như của revision mới.
- Lỗi registry không trả success; record hết TTL được dọn khi lưu mới; đạt 2000 record còn hạn sẽ từ chối lưu thay vì loại snapshot còn hiệu lực.
- Verification: TypeScript, scoped lint, diff check PASS; 5 files / 26 tests PASS. Chưa có browser/live provider/build sau registry.
- Binding vào decision/approval consumer còn cần nối ở bước kế tiếp; snapshot hiện không approvable. Registry hash không bảo vệ trước attacker có toàn quyền ghi filesystem; lock chưa hỗ trợ nhiều process/replica.

## Cập nhật: consumer decision/approval theo registryId

- `POST /api/automation/decisions` nhận registryId/company/provider/campaignId; bỏ qua proposal và số liệu client.
- Resolver lấy account mapping và policy revision hiện hành từ server rồi kiểm TTL/hash/binding bằng registry.
- Decision audit có decisionId riêng, registryId, payloadHash, binding và expiresAt.
- `POST /api/automation/approve` đổi contract sang `{ decisionId }`, không nhận decision budget từ client. Approval kiểm lại registry, company access, policy, hash và TTL trước persist. Client cũ gửi nguyên decision sẽ nhận 400 và cần nâng consumer.
- Collector hiện `approvable:false`; decision Google được ghi blocked với budget thật từ snapshot. Meta chưa xác minh đơn vị budget nên từ chối tạo decision bằng 409 thay vì dùng 0. Không có đường mới cấp quyền apply thật.
- Verification: TypeScript PASS; 6 files / 37 tests PASS; scoped lint và diff check PASS. Chưa gọi live provider hoặc build mới sau bước này.
- Kế tiếp: nguồn KPI/ROAS/attribution và learning status được xác nhận; chuẩn hóa currency/budget semantics; policy/account binding tại execution; lock campaign/quota; UI registry/decision state; browser/runtime acceptance.

## Cập nhật: execution binding, campaign lock và quota

- Execution bắt buộc có registryId/hash/expiry/binding trên decision. Resolve lại account mapping và policy revision hiện hành; adapter phải khai đúng provider/account. Snapshot read-only hoặc approval legacy không binding không thể ghi provider.
- Hash approval bao gồm decision ID, registry ID/hash, expiry và provider/account/company/campaign/policy revision.
- Reservation ledger atomic và process-local lock: chống approval replay, khóa campaign cùng provider/account trong ngày UTC hoặc trong cooldown, cap mỗi company/ngày và mỗi run. Giữ quota reservation khi kết quả chưa rõ, không tự trả quota để retry.
- Run key hiện là policy revision, nên cap per-run áp dụng bảo thủ cho cùng revision trong ngày; chưa phải scheduler run ID độc lập. Ledger chưa có retention/đối soát release và chưa có khóa phân tán.
- KPI hiện chỉ là target tháng company/kênh, không phải break-even campaign. Attribution chưa đủ campaign-level business evidence; learning status và budget currency normalization chưa nối authoritative. Meta budget tiếp tục minor units và không approvable; Google shared budget không được dùng để apply campaign riêng.
- Tests execution/campaign/quota và regression: 6 files / 37 tests PASS, TypeScript/scoped lint/diff check PASS trước bổ sung hash binding. Cần regression lại và build trước khi bàn giao final.
- Chưa gọi Meta/Google live hoặc bật apply endpoint.

## Trạng thái đối chiếu mới nhất — không dùng phần trăm ước đoán

### Đã có và kiểm chứng trên website
- Policy settings backend đọc/lưu Draft OFF/read-back; trang Claude và Auto-Apply APIs đã phục hồi dependency standalone.
- Deploy e3612d4 succeeded; browser thật 0 hydration/JS errors khi mở settings Claude/Automation sau deploy.
- Dependency gate lần gần nhất: 0 critical/0 high, 14 moderate; đây là kết quả tại thời điểm remediation, không phải cam kết vĩnh viễn.

### Đã có code, chưa hoàn tất business/runtime automation
- Snapshot collectors Google/Meta, registry TTL/binding; simulation không approvable.
- Approval decision ID/server snapshot; durable claim/replay, reservation và mock read-back. Chưa có đường apply thật từ collector read-only.
- KPI/attribution/learning campaign-level, currency conversion Meta/shared Google budget chưa đủ để auto-optimize.

### Đang thực hiện
- GET decision history company-filtered, bounded 100 entries, no raw source/account/token; storage corruption returns error.
- Trang `/automation/decisions` read-only với trạng thái loading/empty/error, simulation/blocked và link policy; không có nút approval/apply.
- Verification: TypeScript/scoped lint PASS; 32 files / 133 tests PASS. Build đang chạy; browser chưa kiểm cho màn mới.

### Thứ tự tiếp theo
1. Browser/build acceptance cho history; commit/deploy khi đạt.
2. Evidence nguồn campaign KPI/attribution/learning và currency; không coi target company là campaign profit.
3. UI snapshot/decision creation read-only dựa trên provider/account scope đã xác nhận.
4. Approval expiration/revocation/reconciliation UI và durable execution kiểm đa process trước apply thật.
5. Provider adapters và undo trên campaign test được chỉ định; không test bằng budget live đang tiêu.
6. Monitoring phù hợp quota, notification dedup và outcome 3/7 ngày.
7. Tích hợp marketing playbooks với business profile thật; docs hiện không tương đương runtime marketing agents.

Lead/opportunity, COGS/refund riêng không bắt buộc cho phạm vi doanh thu MBC/đơn MBI/campaign mà user đã chốt. Profit automation chỉ là lựa chọn riêng nếu có nguồn và duyệt công thức.

## Bàn giao lịch sử và giao diện snapshot kế tiếp

- Commit 7b925b0: decision history GET/UI đã push GitHub main; hosted job cmwosra3i2fx00i5f6jg778re đang chạy, chưa xác nhận live.
- Bước tiếp local: CampaignSnapshotPanel đọc snapshot theo company/provider/campaign/date, hiển thị source gaps/TTL/currency/observed days và ghi assessment read-only từ registry ID. Không có approve/apply. Meta unknown budget units không được tạo assessment.
- Local verification: TypeScript/scoped lint PASS, 32 files / 133 tests PASS. Build đang chạy; browser cho panel snapshot chưa kiểm.
- Không sửa auto-apply cũ, policy thực vẫn Draft/OFF; không tạo khóa MCP hoặc ghi budget provider trong đợt này.

## Kết quả chốt panel snapshot

- Production build local PASS (job bjrejlvex). Regression: 32 files / 133 tests PASS; TypeScript/scoped lint PASS.
- Browser fixture dùng component thật, CSS build và mock session/permissions/API: PASS cho đọc thành công, null spend, POST chỉ registry reference, TTL hết hạn không POST, Meta không cho lưu đánh giá, API error/recovery, mobile 375px không overflow và 0 page errors. Ảnh mobile đã review. Không có dữ liệu giả được nạp vào website thật; server fixture đã dừng.
- Artifact tạm: /tmp/ads-snapshot-browser/mobile.png. Đây chưa phải backend/provider live acceptance hay full Next routing/screen reader.
- Deploy lịch sử 7b925b0, version 23: FAILED do build vượt 12 phút. Trang lịch sử/panel snapshot chưa được xác nhận live. Host diagnose lỗi HTTP 410; raw logs chỉ có timeout, chưa có substep để kết luận nguyên nhân. Không tạo deploy chồng hoặc tự tăng RAM/timeout.
- Kế tiếp cần điều tra đường build host và kiểm khả năng source/image trace trước khi redeploy. Cần Ops cung cấp log npm/Next/Docker từng bước nếu nền tảng không trả được; phần runtime app cũ giữ nguyên.

## Approval lifecycle — bước tiếp sau rollout snapshot

- Deploy c57377b succeeded (job cmwp1vkut2jb50i5fm9svnlwy). Live authenticated `/api/automation/decisions` 200 JSON; history/snapshot panels visible, mobile 375px no overflow, 0 page errors; no provider snapshot submitted in acceptance.
- New local work: approval summary GET and revoke DELETE `/api/automation/approvals`, restricted to super_admin and authorized companies. Projection excludes raw decision, account, snapshot hash, secret and provider error text.
- Revocation only allowed for unexpired approved rows; records revokedAt/revokedBy from server actor in same durable approval record. Consumed work cannot be revoked/reopened and stays needs_reconciliation when no outcome exists. Expiry is computed on read without changing consumed status.
- Revoke/claim serialized under process-local store lock, exactly one winner in race test. No multi-process safety claim, no auto-release of quota reservation and no provider mutation endpoint enabled.
- Verification: TypeScript/scoped lint PASS, 33 files / 140 source tests PASS. Production build pending; lifecycle UI not yet implemented or tested in browser.
- Next: approval lifecycle UI with confirmation/reason/conflict states; expiry/revocation policy-version invalidation presentation and read-only reconciliation; real provider adapters require business evidence and explicit test campaign scope.

## Giao diện xem/thu hồi approval

- ApprovalLifecyclePanel nằm trong `/automation/decisions`, chỉ hiển thị cho session super_admin; backend vẫn tự kiểm role/company.
- Hiển thị approved/expired/consumed/revoked và needs_reconciliation. Không có nút approve/apply hoặc hoàn tác budget.
- Thu hồi cần Dialog xác nhận company/campaign/approval ID; Hủy/Escape không gửi DELETE. Trạng thái đang gửi vô hiệu các thao tác trùng.
- HTTP 404/409 báo stale conflict; lỗi không rõ kết quả yêu cầu reload và khóa tất cả nút revoke đến khi tải lại thành công. Không tự retry ghi.
- Tests source: 33 files / 140 tests PASS, TypeScript và scoped lint PASS. Browser fixture component thật + Dialog Base UI + mock API/session PASS: confirm/cancel/Escape, revoke, consumed disabled, conflict/error lock, reload, 403, empty, mobile 375px no overflow, 0 JS errors; server test đã dừng. Ảnh tạm /tmp/ads-approval-browser/mobile.png. Không có thu hồi production.
- Production build lifecycle API/UI PASS (exit 0). Browser fixture chạy lại sau khi chờ animation PASS; server fixture đã dừng. Chưa commit/push/deploy lifecycle API/UI; chưa thu hồi approval thật.

## Rollout approval và bước đối soát kế tiếp

- Commit b7d5d1a lifecycle API/UI đã push GitHub main; job cmwp3uq6o2jp00i5fs8ol8nx7 đang build, chưa xác nhận live. Không có production revocation.
- Local next step: pure reconciliation classifier so sánh before/proposed/observed khi caller xác nhận cùng scope/unit. Trả matches_proposed/matches_before/different_value/unverified; mọi kết quả executionProven=false, retryAllowed=false, undoAllowed=false. Giá trị khớp không chứng minh actor hoặc thành công của lệnh.
- 34 files / 149 tests PASS; TypeScript/scoped lint PASS. Chưa API/UI/provider reader/store integration cho reconciliation và chưa build sau helper.
- Cần nối quan sát provider read-only có binding/TTL, lưu audit observation và UI trạng thái trước khi cho người quản trị xử lý đối soát. Không release approval hoặc quota tự động.

## Đối soát snapshot — observation backend/UI

- Deploy approval lifecycle b7d5d1a succeeded (job cmwp3uq6o2jp00i5fs8ol8nx7); chưa acceptance live lifecycle trong bước này.
- POST `/api/automation/approvals/observe` nhận approvalId/company/registryId, server actor; không nhận budget client làm evidence. Restricted super_admin/company scope.
- Store resolve snapshot hiện hành (TTL/binding), đòi consumed approval, Google daily budget, currency/budgetKind gốc rõ ràng, cùng account/policy và quan sát không trước claim. Legacy approval thiếu currency/budgetKind bị chặn, không suy diễn đơn vị.
- Lưu tối đa 100 observations mỗi approval với snapshot hash/actor/timestamp; outcome/claim/quota giữ nguyên. UI chỉ hiển thị lastObservation và warning không chứng minh execution; chưa có form gửi observation.
- 36 files / 154 tests PASS, TypeScript/scoped lint PASS. Production build đang chạy; browser observation UI chưa kiểm; chưa commit/push/deploy nhóm mới.
- Còn lại: lưu currency/budgetKind có provenance trên authoritative decision, kiểm thứ tự thời gian quan sát/staleness, browser/API acceptance, form nhập registry reference từ snapshot đã đọc và transactional multi-process coordination trước live apply.

## Form ghi nhận quan sát đối soát

- Approval consumed/needs_reconciliation có form nhập registryId snapshot mới; snapshot panel hiển thị registry ID để lấy mã đúng. Không nhận số budget client.
- Dialog xác nhận hiển thị company/campaign/approval/registry. Escape/Hủy không POST; khi gửi khóa thao tác. Thành công vẫn giữ outcome cần đối soát. Conflict/403/lỗi chưa rõ kết quả khóa form đến khi reload danh sách. Không retry/undo/reset claim/quota.
- Browser fixture component thật + Base UI Dialog + mock APIs/session PASS: confirmation, Escape, payload tham chiếu, success, 409/503/403, reload, mobile 375px no overflow, 0 page errors. Server fixture dừng; không ghi quan sát production. Ảnh tạm /tmp/ads-observation-browser/mobile.png. Chưa screen reader/full backend live.
- TypeScript/scoped lint PASS; 36 files / 154 tests PASS. Build UI mới đang chạy. Nhóm reconciliation backend/UI chưa commit/push/deploy.

## Chốt provenance và thứ tự observation

- Registry decision Google chỉ nhận currency ISO và campaign_daily_budget có giá trị hợp lệ; currency/budgetKind được lưu trong audit và hash approval. Shared budget/Meta không xác minh không tạo decision bằng 0 hoặc đoán đơn vị.
- Observation chặn registry trùng, thời gian tương lai và timestamp không mới hơn kết quả đã lưu; lastObservation không bị snapshot cũ đè lên.
- Regression 36 files / 155 tests PASS; TypeScript/lint toàn scope/diff check PASS; dependency HIGH/CRITICAL gate exit 0. Build release đang chạy.
- Chưa commit/push/deploy nhóm observation hiện tại. Provider mutation/undo/retry không được bật; live collector business evidence vẫn chưa đủ để cấp approval thật.

Production build cuối nhóm observation/provenance PASS (exit 0, job bchxyag0o). Release không kích hoạt apply; kiểm live chỉ đọc sau deploy.

## Thu thập snapshot — thời gian và runtime Google

- Local timing hardening: readAt/TTL neo vào lần đọc đầu; collectedAt + collectionDurationMs ghi thời điểm hoàn tất. Collection >=15 phút hoặc clock không hợp lệ bị từ chối; không gia hạn TTL bằng lời gọi cuối. Chưa deploy thay đổi timing này.
- Verification local: 37 files / 159 tests PASS; TypeScript/scoped lint PASS. Build timing đang chạy.
- Website hiện tại sau cập nhật OAuth: đọc campaigns MBC HTTP 200, chọn 1 campaign thuộc response, đọc snapshot kỳ 2 ngày HTTP 200; registry saved, currency VND, campaign_daily_budget, observedDays=0, approvable=false. Không dump metrics/account hoặc tạo approval/budget mutation. Đây là acceptance collector read-only giới hạn, không xác nhận learning/attribution/profit.
- Còn lại: binding nguồn KPI/attribution campaign-level và learning authoritative; không dùng KPI company thay ROAS hòa vốn. Chưa live Meta acceptance hoặc full provider mutation.

## Acceptance Google có chi tiêu và consistency

- Live bounded read: chọn campaign ACTIVE có spend >0 từ API company-scoped cho MBC và MBI, kỳ 7 ngày kết thúc hôm qua; mỗi company tối đa 1 snapshot. Cả hai HTTP 200, registry saved, observedDays=7, spend dương và khớp campaign response trong 1 đơn vị currency; VND/campaign_daily_budget/approvable=false. Không dump metrics/names/account hoặc tạo approval/budget mutation.
- Local tiếp theo: Google snapshot lưu spendConsistency matched/mismatch giữa tổng daily và tổng kỳ; lệch >1 micro-unit được ghi explicit missingSources daily_period_spend_mismatch, không âm thầm thay dữ liệu. Duplicate daily dates bị từ chối.
- TypeScript/scoped lint PASS, 37 files / 161 tests PASS. Timing+consistency build đang chạy; chưa commit/push/deploy nhóm mới.

## Ước lượng tiến độ automation theo deliverable (không phải KPI đo thực tế)

Đánh giá phạm vi automation supervised, chưa bao gồm full-auto/profit/creative/SEO: khoảng 60%, ước lượng lập kế hoạch tại thời điểm này. Mỗi nhóm trọng số bằng nhau 10%, chấm theo các điều kiện còn thiếu; không phải xác nhận production-ready.

1. Policy/settings: 80% — Draft OFF/live readback có; approval/activation và policy đa tầng còn thiếu.
2. Collector/registry/freshness: 80% — scope/TTL và Google live positive-spend có; Meta live/unit/business sources chưa đủ.
3. Evaluator/evidence business: 45% — simulation/block guards có; decision actionable từ KPI/attribution/learning còn thiếu.
4. Approval lifecycle: 75% — server ID/hash/TTL/revoke/claim có; expiry/revision UI và ràng buộc runtime hoàn chỉnh còn thiếu.
5. Execution concurrency/quota: 50% — reservation một process có; đa process/shared budget/daily delta cap còn thiếu.
6. Reconciliation: 70% — helper/store/API/form + fixture có; observation live và lịch sử chi tiết còn thiếu.
7. Automation UI: 70% — history/snapshot/approval có; action queue đầy đủ và business source explanation còn thiếu.
8. Provider adapter/undo: 25% — existing legacy clients/routes + mock orchestration có; unified staging apply/readback/undo chưa đạt.
9. Monitoring/outcome: 30% — job/outcome nền cũ có; integration mới 3/7 ngày/dedup chưa đủ.
10. Release/security/runtime: 75% — dependency high/critical=0, build/runtime packaging và settings/browser verified; chưa provider write/rollback acceptance, còn moderate advisories.

Tổng điểm có trọng số bằng nhau = 60%. Ưu tiên kế tiếp: deploy timing/consistency → UI evidence source gaps → decision actionable non-profit khi có business policy/learning nguồn thật → approval + provider staging acceptance. Không cần COGS để đóng read-only revenue/order/pacing; profit optimization tách riêng.

## Giải thích nguồn evidence trên giao diện

- Source gaps được trình bày bằng lời giải thích vi/en; mã kỹ thuật giữ trong details. Không biến Google conversion value hoặc KPI company thành doanh thu/break-even campaign.
- Snapshot UI hiển thị readAt/collectedAt và daily/period spend consistency khi payload có; tương thích snapshot cũ không có trường mới.
- Decision snapshot_not_approvable được giải thích rõ là không cấp quyền đổi budget.
- Verification: TypeScript/scoped lint PASS; 38 files / 170 source tests PASS; browser fixture snapshot regression PASS (success/error/TTL/Meta disabled/null spend/mobile/zero JS errors), all APIs mocked and server stopped. Build đang chạy. Chưa commit/push/deploy nhóm UI này.
- Job timing release cmwp84yfr2keu0i5fz6bc2k9h vẫn running ở lần kiểm cuối; không kết luận deployed, không tạo job chồng.

## Release verification 2026-11-21

- Evidence UI: full suite 38 files / 170 tests PASS; 71 tests skipped, không coi skipped là acceptance. TypeScript, scoped ESLint, diff check và production build PASS.
- Production dependency audit: HIGH/CRITICAL gate PASS; còn 14 moderate. Không force upgrade dependency breaking.
- GitHub main được kiểm read-only ở 8ffcb0a trước release; chưa xác minh deployment runtime mới trong lượt này.
- Bước P0 kế tiếp đang bổ sung Google learning evidence từ campaign.bidding_strategy_system_status; ACTIVE/ENABLED không chứng minh mature, snapshot vẫn approvable=false. Provider runtime acceptance còn thiếu.

### Google learning evidence và blocker push

- Commit evidence UI: 9699d73. Push GitHub main bị từ chối: SSH identity junnyken không có quyền ghi marcommatbao/ads-manager-chinh; commit còn local, không kết luận deployed.
- Collector Google đọc campaign.bidding_strategy_system_status (field/enum được đối chiếu SDK v23 đã cài). Chỉ LEARNING_* và MULTIPLE_LEARNING xác nhận đang learning; ENABLED/ACTIVE/unknown không chứng minh mature.
- Learning evidence tham gia snapshot hash. Vẫn approvable=false; doanh thu, attribution và break-even guards không bị gỡ.
- Focused regression 4 files / 61 tests PASS, scoped ESLint PASS. Full suite 38 files / 206 tests PASS, 71 skipped; TypeScript, scoped ESLint và production build PASS. Chưa provider live acceptance.
- GitHub reconnect: Coder external-auth xác nhận repository push permission; chuyển riêng remote github sang HTTPS và credential helper external-auth, không lưu token vào repo/config. Lỗi SSH junnyken không còn là đường push được sử dụng.
- Điều kiện trước provider write acceptance: campaign test/account/currency/budget range đã xác nhận, policy nghiệp vụ được duyệt và coordination an toàn. Không bật apply hoặc sửa auto-apply cũ trong đợt này.

## P0 tiếp theo — Gate 3 và execution coordination (2026-11-21)

- GitHub main đã được xác nhận trùng 4ca7492 sau push thành công; file token tạm đã xóa. Không suy deployment live từ push.
- Repository-wide lint FAIL: 909 errors / 860 warnings. Scoped lint của nhóm release trước PASS; không được gọi toàn repo sạch lint. Google GAQL date check chạy riêng PASS.
- executeStoredApproval hiện hard-block EXECUTION_COORDINATION_UNVERIFIED trước đọc policy/snapshot, reservation, claim và provider access. Chưa có transactional coordinator; không cho boolean/env hoặc HTTP mở khóa.
- Guard regression 25/25 tests PASS; scoped ESLint/diff check PASS. Test mới kiểm approval và filesystem không đổi, provider calls bằng 0 ngay cả khi policy bật. Legacy auto-apply routes không thay đổi.
- Đây là safety stop, KHÔNG phải hoàn thành concurrency đa process. Trước khi thay guard phải triển khai transactional reservation+claim và khôi phục binding/policy/outcome validation, rồi test crash/restart/concurrency.
- Gate 3 thêm 19 route integration tests qua engine thật, mock provider/auth/AI boundary: unauthorized/disabled/cache/throttle không gọi generation khi bị chặn; critical source failure không gọi AI; healthy source là positive control; fallback/history handoff được kiểm.
- GET/POST generation errors không được nhận diện cấu hình trả generic message thay vì diagnostic gốc. Known configuration guidance được giữ. Source-error text trong successful blocked dataGaps chưa được làm sạch trong nhóm này, không coi là universal sanitization.
- Full regression: 40 files / 226 tests PASS, 71 skipped. TypeScript/scoped ESLint/diff check PASS. Production build PASS (exit 0). Chưa runtime acceptance/deploy; Coder external-auth write handshake vẫn HTTP 403, credential tạm của đợt trước đã xóa nên chưa push nhóm mới.

## Gate 3 diagnostic privacy follow-up — 2026-11-21

- Source failures expose only fixed source/unavailable wording; Error/string/object diagnostic payloads are not stringified into gaps or logs. AI fallback and route generation/history-write logs use fixed categories.
- History normalizes dataGaps/evidence.note on write and legacy read. Reads do not migrate deployed files; a later successful save normalizes retained entries. Not a general redaction of every snapshot field.
- Added synthetic secret and token-URL regressions for API/cache/history handoff/logs; history fixture now uses isolated temp directories, not repository data/.
- Full suite 40 files / 230 tests PASS, 71 skipped; final route/history rerun 25/25 PASS. TypeScript, scoped ESLint, diff check and production build PASS (exit 0). Worker wrapper ended codex_turn_failed after edits; main independently reviewed and verified results.
- Push uses dedicated repo deploy key via git push-github; Coder GIT_SSH_COMMAND must not override it. Gate 3 browser/runtime acceptance and transactional coordinator remain pending; no provider write, feature activation or deployment performed.

## Runtime read-only acceptance and campaign attribution blocker — 2026-11-21

- Acceptance target from existing credential configuration matches documented adscommand-chinh.vibe.tinhgon.xyz. Authenticated session, briefing history (limit 1), MBC decision history and decisions page return HTTP 200; secrets and business payloads were not printed.
- Real Chromium browser with authenticated session: /automation/decisions desktop HTTP 200, expected history/approval/snapshot headings, 0 page errors. Mobile 375px has no horizontal overflow; screenshot visually reviewed. No business writes or provider snapshot collection submitted; browser closed. Tooling installed only in isolated /tmp venv, no stack started.
- This confirms read-only Automation UI availability, NOT source commit/deployment identity, all Gate 3 briefing states, provider freshness or staging isolation. Briefing generation GET/POST and writes were excluded. Gate 3 stays open pending controlled runtime evidence.
- Campaign/provider attribution integration BLOCKED: Odoo campaign labels are product labels, not Google/Meta campaign IDs; click matcher links orders to leads without provider campaign binding. Existing empty-store fallbacks cannot prove zero orders. Do not invent mapping or reuse company/label coverage as campaign coverage.
- Required next input: authoritative company/provider/account/campaign binding and source availability/completeness/read timestamp; no COGS requirement for read-only revenue/orders. See ACCEPTANCE.md for detailed feasibility evidence. No runtime code added in this step; focused existing suites 63 PASS, scoped lint/diff check PASS; no build claim for a new feature.

## Transactional coordinator foundation — 2026-11-21

- Added isolated SQLite reserve+claim coordinator using node:sqlite, BEGIN IMMEDIATE, prepared statements, permanent approval identity, campaign cooldown and company/day/run quotas. Replay returns already_claimed, never permission to retry. No provider calls or existing approval imports; executeStoredApproval hard guard unchanged.
- Single-host/local filesystem only; shared path across executors required. Not cross-host/network filesystem safety. Future integration must restore trusted approval/source/policy validation and outcome reconciliation before removing guard. Retention, budget delta caps, runtime bundle and actual persistent storage verification remain pending.
- Actual OS-process contention, restart replay, failed insert rollback, SIGKILL before COMMIT, corruption/busy/future clocks validated. Focused 10/10 PASS; final full regression 240 PASS / 71 skipped, 0 failed; TypeScript/scoped lint/diff check and production build PASS.
- Node22.23.2 SQLite3.51.3 verified locally. node:22-alpine image pulled, but bounded runtime probe could not start due Docker host cgroupv2 invalid state. Did not disable resource limits; no stack/service started. App build alone does not prove dormant coordinator standalone wiring.
- No dependency added; production audit HIGH/CRITICAL gate exit0. No production migration, deployment, activation or provider budget write performed. Details: EXECUTION-COORDINATOR.md.
