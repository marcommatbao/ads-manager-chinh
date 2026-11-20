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
