# Master Implementation Plan — AdsCommand

**Mục tiêu:** hoàn thiện AdsCommand thành hệ thống đo lường và tự động hóa quảng cáo có kiểm soát; quyết định ngân sách/lợi nhuận dùng rule và dữ liệu có bằng chứng, không dùng AI/LLM trên decision path.

**Phạm vi plan:** hoàn thiện Gate 3–6, triển khai automation theo các mức recommendation → dry-run → approval → supervised apply → limited auto; sau đó mới xem xét các phase tiếp theo.

**Nguyên tắc bất biến**

- Dữ liệu thiếu, stale, partial hoặc ambiguous không được biến thành 0 có ý nghĩa nghiệp vụ.
- Mọi kết luận/đề xuất phải có source, khoảng thời gian, readAt và trạng thái chất lượng.
- AI chỉ được giải thích/tóm tắt; không chọn campaign, mức budget hoặc action.
- Không mutation provider nếu chưa qua guardrail, approval và read-before-write.
- Không tự bật full-auto, không tự pause campaign ở giai đoạn đầu.
- Production write, deploy chính thức và cấu hình production do main thực hiện.
- Một beta dùng chung; preview phải tự tắt, có owner và không chạy vô hạn.

---

## Trạng thái hiện tại

| Khu vực | Trạng thái | Đã có | Còn chặn |
|---|---|---|---|
| Gate 3 — AI Analyst | in_progress ~85% | quality gate, evidence, fallback/blocked, history, auth API, UI | authenticated browser/staging acceptance |
| Gate 4 — Forecast/Pacing | in_progress ~80% | confidence, minimum days, budget kind, API/UI, Google route tests | runtime account/campaign/KPI acceptance |
| Gate 5 — Attribution | in_progress ~75% | campaign label, click/UTM matcher, event-store report, duplicate/ambiguous guard, auth API | staging matched/unmatched acceptance |
| Gate 6 — Profit | in_progress ~55% | profit contract, readiness API/UI, formula version, BA flag | BA approval, COGS/refund source, populated runtime |
| Automation A/B | implementation started | evaluator, audit, dry-run, approval TTL/hash, provider-neutral readback | real provider adapters, kill switch, staging apply |
| Security | blocked for public | direct dependency upgrades/build pass | npm audit còn 4 critical/22 high |

---

# Stage 0 — Preconditions and safety gate

## Deliverables

1. Cấu hình staging riêng, có session test và connector sandbox/test.
2. Ghi owner, môi trường, thời hạn tự tắt và rollback.
3. Xác nhận không dùng production DB/volume cho staging acceptance.
4. Hoàn thiện env Vibe Host còn thiếu:
   - `NEXT_PUBLIC_AD_ACCOUNT_ID` nếu UI cần build-time;
   - `NEXTAUTH_URL`;
   - `VERCEL_URL` nếu job cần;
   - webhook variables nếu thực sự dùng;
   - Redis chỉ khi module cache yêu cầu.
5. Cập nhật `docs/STABILIZATION-INPUTS.md` với giá trị đã xác nhận, không commit secret.

## Blocker

Không chạy runtime acceptance thật nếu chưa có staging endpoint/session/credentials. Không suy IP, env hay database từ tên domain.

## Kiểm tra

- `/login` và `/api/health`.
- Connector health không lộ token.
- Tự tắt sau đúng thời hạn.
- `docker compose`/Vibe Host log không có secret.

---

# Stage 1 — Đóng Gate 3: AI Analyst

## Deliverables

1. Authenticated browser acceptance cho Dashboard Morning Briefing.
2. Kiểm tra các state:
   - loading;
   - AI success khi nguồn complete;
   - fallback khi Gemini timeout/error;
   - blocked khi Meta/source critical unavailable;
   - source partial/stale;
   - history empty/error;
   - evidence panel.
3. Xác nhận `generateAiSummaryWithQualityGate` không gọi AI khi critical source unavailable.
4. Ghi screenshot/JSON response/test log vào `docs/TEST_LOG.md` và `docs/ACCEPTANCE.md`.

## Acceptance

- Không có AI call khi source critical lỗi.
- AI/fallback/blocked mode hiển thị khác nhau.
- Evidence có source/from/to/readAt/status.
- History yêu cầu auth, không chứa prompt/raw response/secret.

## Rollback

Tắt feature flag briefing; giữ API history và evidence backward compatible. Không rollback về hành vi coi unavailable là zero.

---

# Stage 2 — Đóng Gate 4: Forecast và Budget Pacing

## Deliverables

1. Runtime acceptance với dữ liệu staging:
   - account balance;
   - campaign budget;
   - internal KPI.
2. Xác nhận ba `budgetKind` không bị trộn.
3. Test zero thật, unavailable, stale, partial, dưới 3 ngày, budget null.
4. Kiểm tra Budget Pacing UI:
   - projection đủ điều kiện;
   - warning insufficient;
   - không render projected spend null;
   - source/range/readAt.

## Rules

- <3 ngày: không forecast.
- Forecast supervised: khuyến nghị tối thiểu 7 ngày.
- Profit optimization: khuyến nghị tối thiểu 14 ngày.
- Account balance không dùng làm campaign budget.
- Campaign budget không dùng làm internal KPI.

## Rollback

Giữ API cũ và ẩn projection; không áp dụng budget change.

---

# Stage 3 — Đóng Gate 5: Attribution

## Deliverables

1. Runtime event store acceptance:
   - matched bằng click ID;
   - matched bằng UTM campaign;
   - matched bằng campaign label;
   - order không evidence;
   - duplicate order;
   - ambiguous evidence.
2. Xác nhận `matchedOrderRate`, `matchedRevenueRate`, `duplicateOrders` trên dữ liệu staging.
3. Xác nhận API `/api/attribution/report` có auth/company scope/date validation và không trả PII.
4. Ghi coverage/unmatched reason vào acceptance log.

## Rules

- Click ID ưu tiên UTM, UTM ưu tiên campaign label.
- Identity email/phone không đủ để gán nguồn quảng cáo.
- Không evidence → unmatched.
- Nhiều lead cùng evidence → ambiguous/unmatched.
- Duplicate order key chỉ tính một lần.

## Rollback

Tắt attribution report mới; giữ campaign-label report cũ; không gán lại doanh thu lịch sử tự động.

---

# Stage 4 — Đóng Gate 6: Profit

## Deliverables bắt buộc trước populated profit

1. BA phê duyệt `phase6-v1` hoặc sửa công thức.
2. Xác nhận nguồn:
   - gross/net revenue;
   - refund/return;
   - COGS;
   - company-scoped ad spend.
3. Xác nhận date semantics và timezone của từng nguồn.
4. Nối adapter source thật; mỗi component phải có source/range/readAt/status.
5. UI populated state chỉ render khi quality allowed.

## Công thức hiện tại cần BA duyệt

```text
netRevenue = grossRevenue - refunds
grossProfit = netRevenue - COGS
netProfitAfterAds = grossProfit - adSpend
grossMarginPct = grossProfit / netRevenue * 100
breakEvenRoas = (COGS + adSpend) / adSpend
```

Nếu thiếu COGS/refund hoặc lệch range:

```text
quality.allowed = false
confidence = insufficient
profit fields = null
```

## Acceptance

- COGS unavailable không thành 0.
- Refund không bị tính hai lần.
- Cùng company/date range.
- Profit API/UI hiển thị missing sources và `requiresBaApproval`.
- Runtime fixture có lời, lỗ, refund, zero revenue, missing COGS.

---

# Stage 5 — Automation policy và kill switch

## Tạo/sửa

```text
lib/automation/policy.ts
lib/automation/kill-switch.ts
lib/automation/source-snapshot.ts
lib/automation/decision-audit.ts
```

## Policy contract

```ts
interface AutomationPolicy {
  globalEnabled: boolean;
  applyEnabled: boolean;
  companyEnabled: Record<string, boolean>;
  providerEnabled: Record<string, boolean>;
  minAttributionCoverage: number;
  minObservedDays: number;
  minProfitConfidence: "high" | "medium";
  maxIncreasePct: number;
  maxDecreasePct: number;
  minBudget: number;
  maxBudget: number;
  cooldownHours: number;
  maxMutationsPerRun: number;
  maxMutationsPerDay: number;
  protectedCampaignIds: string[];
}
```

## Kill switch

- Global.
- Company.
- Provider.
- Campaign.
- Rule.

Evaluator vẫn chạy read-only khi kill switch bật; apply luôn bị block và audit lý do.

## Acceptance

- Tắt global giữa evaluate/apply → apply block.
- Tắt provider → provider adapter không được gọi.
- Tắt campaign → decision blocked.
- Toggle có RBAC/audit/who/when.

---

# Stage 6 — Monitoring và alert/action

## Mục tiêu

Chu kỳ khoảng 15 phút chỉ chạy khi scheduler/runtime được cấu hình thật; không tuyên bố đã chạy chỉ vì registry có cron entry.

## Pipeline

```text
collect snapshots
→ validate source quality
→ evaluate deterministic rules
→ create alert/decision
→ notify with evidence/action link
→ audit
```

## Alert types

- spend spike;
- CPA/CPL vượt mục tiêu;
- ROAS dưới break-even;
- campaign zero delivery;
- budget near cap;
- frequency high;
- connector stale/error;
- attribution coverage low;
- read-back mismatch.

Mỗi alert có severity, company, campaign, sourceRefs, action, dedup key, delivery status.

## Không dùng AI

AI chỉ tóm tắt alert sau khi rule engine đã quyết định; AI không được tạo action.

---

# Stage 7 — Provider adapters trên staging

## Meta adapter

```ts
readBudget(campaignId)
setBudget(campaignId, budget, idempotencyKey)
readBudget(campaignId)
```

## Google adapter

Xác nhận trước:

- daily vs shared budget;
- micros conversion;
- field mutation;
- learning status;
- read-back field;
- provider rate limit.

## Apply protocol

```text
check approval TTL/hash
→ read current
→ compare with approved current
→ enforce policy/floor/ceiling/step
→ set with idempotency key
→ read back
→ applied/readback_mismatch/failed
→ audit
```

Nếu current budget thay đổi sau approval: block, không ghi đè.

## Undo

Undo chỉ được nếu current provider value vẫn bằng giá trị đã apply. Nếu có người sửa tay sau đó, undo block `current_value_changed`.

## Rollout

- Một provider.
- Một company.
- Staging only.
- Tối đa 1–5 mutation/day.
- Không pause campaign.
- Không cross-channel allocation.

---

# Stage 8 — Automation UI

## Automation Center

- Decision list.
- Dry-run diff.
- Approval queue.
- Apply status.
- Read-back status.
- Undo status.
- Blocked reason.
- Audit detail.
- Kill switch/policy.

## UI states

- loading;
- empty;
- insufficient;
- stale;
- blocked;
- awaiting approval;
- approved but expired;
- applied;
- mismatch;
- failed;
- undone.

Không cho client tự truyền proposed budget để bypass evaluator; server tính lại decision.

---

# Stage 9 — Outcome tracking 3/7 ngày

## Flow

```text
before snapshot
→ apply
→ +3 days outcome
→ +7 days outcome
→ compare
→ positive/neutral/negative/inconclusive
→ update policy confidence
```

Metrics:

- spend;
- revenue/orders;
- CPA/CPL;
- ROAS;
- attribution coverage;
- gross margin khi COGS đã có;
- learning state.

Không gọi tương quan là nguyên nhân nếu không có thiết kế experiment.

---

# Stage 10 — Security/remediation và release gate

## Dependency groups

1. Node types/toolchain → Vitest/tinypool.
2. `google-ads-api` và protobuf/stream-json.
3. `proxy-addr` chain.
4. shadcn/Vite tooling.

Mỗi nhóm chạy:

```text
npm audit
npm install/build
npx tsc --noEmit
source tests
source lint
npm run build
```

Không dùng `npm audit fix --force` hoặc `--legacy-peer-deps` thay cho compatibility plan.

## Public release gate

Không public beta/go-live khi:

- còn HIGH/CRITICAL chưa xử lý hoặc chưa có exception được duyệt;
- Gate 3–6 runtime chưa pass;
- COGS/refund chưa có nguồn/BA approval;
- provider adapter chưa staging-pass;
- rollback/kill switch chưa test;
- Vibe Host env/Redis cần thiết chưa cấu hình.

---

# Thứ tự tối ưu đề xuất

1. Hoàn tất staging inputs và BA formula approval.
2. Đóng runtime acceptance Gate 3–6.
3. Kill switch + policy engine.
4. Monitoring/action alert.
5. Meta staging adapter.
6. Google staging adapter.
7. Apply/read-back/undo staging.
8. Automation Center UI.
9. Outcome 3/7 ngày.
10. Supervised rollout giới hạn.
11. Dependency security remediation.
12. Chỉ sau Gate 2 mới xem xét limited auto/full auto.

---

# Definition of Done cho supervised automation

- Rule deterministic, không AI decision.
- Tất cả source có quality metadata.
- Dry-run và diff pass.
- Approval RBAC/TTL/hash pass.
- Kill switch pass.
- Idempotency/concurrency pass.
- Provider read-before-write/read-back pass trên staging.
- Undo/rollback drill pass.
- Audit không chứa secret.
- Runtime acceptance Gate 3–6 pass hoặc blocker được ghi nhận.
- Có owner/on-call và giới hạn mutation.

# Definition of Done cho full automation

Ngoài tất cả điều trên:

- Supervised chạy ổn định qua thời gian quan sát.
- Không còn read-back mismatch chưa xử lý.
- Outcome 3/7 ngày có dữ liệu.
- Dependency security đạt hoặc exception được duyệt.
- BA/Manager duyệt policy.
- Gate 2 production readiness pass.
- Có kế hoạch dừng/rollback và người chịu trách nhiệm.

---

# Marketing Capability Layer — upstream skill adaptation

## Source and license

Capability categories are informed by `coreyhaines31/marketingskills` (MIT, Copyright (c) 2025 Corey Haines). See `docs/marketing-playbooks/THIRD-PARTY-NOTICE.md`. Upstream content is not copied into the provider decision path.

## P0 — integrate first

1. `product-marketing` → Business Policy/Profile: products, USP, audience, prohibited claims, targets, protected campaigns.
2. `ads` → deterministic campaign planning and diagnosis checklist over Meta/Google source snapshots.
3. `analytics` → metric definitions, source freshness, zero/unavailable/partial checks.
4. `conversion-tracking` → UTM/gclid/gbraid/wbraid, pixel, GA4 and tracking health.
5. `attribution` → existing evidence-bounded campaign→order report and coverage guard.

P0 outputs are checklists/source contracts; they cannot call provider mutation clients.

## P1 — add after P0

1. `ad-creative` → creative identity/version, hook/angle/limits/fatigue review.
2. `ab-testing` → comparable windows, minimum sample, before/after evidence; no causal claim without design.
3. `marketing-loops` → scheduled health/report loops with deduped notifications and audit.

## P2 — later product surfaces

- `cro`, `copy-editing`, `copywriting` for landing/copy recommendations.
- `seo-audit`, `schema`, `content-strategy` for separate SEO/content surfaces.
- Other upstream skills only when a product request and owner exist.

## Marketing capability guardrails

- Playbooks never choose budget, campaign, provider action, or profit conclusion.
- Deterministic evaluator remains the only automation decision path.
- Copy/creative output requires human review before publication.
- Missing tracking evidence blocks attribution/profit automation.
- Every playbook has source/version/scope and no secret.
