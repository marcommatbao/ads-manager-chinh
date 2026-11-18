# AdsCommand — Roadmap nâng cấp theo giai đoạn

## Nguyên tắc chung

Mỗi giai đoạn phải có: business rules, data contract, UI states, tests, security review và acceptance evidence. Không mở giai đoạn sau khi gate trước chưa đạt. Dữ liệu lỗi/thiếu không được biến thành số 0 hoặc kết luận chắc chắn.

## Giai đoạn 1 — Chuẩn hóa dữ liệu và độ tin cậy (đang thực thi)

**Mục tiêu:** mọi chỉ số có nguồn, trạng thái tin cậy, thời điểm và phạm vi dữ liệu.

**Phạm vi:**
- Chuẩn hóa trạng thái `real`, `stale`, `unavailable`, `estimated`.
- Giữ nguyên phân biệt MBC (doanh thu) và MBI (đơn hợp lệ).
- Chuẩn hóa lỗi Odoo/Google/Meta; không coerce lỗi thành số 0.
- Gắn metadata nguồn, thời điểm đọc và khoảng ngày vào các kết quả nghiệp vụ.
- Test zero thật khác với unavailable.

**Gate:** contract có test; MBC/MBI trả được trạng thái nguồn; Dashboard giữ được empty/error state; typecheck/build/test đạt.

## Giai đoạn 2 — Data Health Center

**Mục tiêu:** một màn hình cho biết connector đã cấu hình, đã xác thực, gọi API được và dữ liệu có mới không.

**Gate:** Google, Meta, Odoo, GA4 và jobs có health record; phân biệt auth/permission/network/timeout/stale; không lộ secret; retry an toàn.

## Giai đoạn 3 — AI Analyst chủ động

**Mục tiêu:** briefing có kiểm tra chất lượng → phát hiện bất thường → bằng chứng → đề xuất.

**Gate:** mọi kết luận trỏ về nguồn/phạm vi/thời điểm; AI không phân tích khi nguồn lỗi nghiêm trọng; lưu lịch sử briefing.

## Giai đoạn 4 — Forecast và budget pacing

**Mục tiêu:** dự báo chi phí, số dư, doanh thu/đơn và ngày hết ngân sách có độ tin cậy.

**Gate:** có confidence và điều kiện tối thiểu; phân biệt số dư tài khoản, budget campaign và KPI nội bộ; không forecast khi dữ liệu không đủ.

## Giai đoạn 5 — Attribution quảng cáo → đơn hàng

**Mục tiêu:** nối campaign/UTM/click/session/lead với đơn Odoo và trạng thái thanh toán.

**Gate:** đo tỷ lệ match và unmatched; không gán doanh thu khi thiếu bằng chứng; không đếm trùng nguồn.

## Giai đoạn 6 — Tối ưu theo lợi nhuận

**Mục tiêu:** doanh thu thuần, hủy/hoàn, giá vốn/biên lợi nhuận và ROAS hòa vốn.

**Gate:** công thức được BA xác nhận; nguồn từng thành phần rõ; xem được cách tính.

## Giai đoạn 7 — Creative Intelligence

**Mục tiêu:** version/tag creative, fatigue, nội dung, funnel và liên kết đơn thật.

**Gate:** creative có identity/version; so sánh cùng điều kiện; AI-generated output phải duyệt.

## Giai đoạn 8 — Experimentation và incrementality

**Mục tiêu:** A/B, holdout, before/after có kiểm soát và đo outcome.

**Gate:** không gọi tương quan là nguyên nhân; lưu thiết kế/kết quả thử nghiệm; có rollback.

## Giai đoạn 9 — Tự động hóa có kiểm soát

**Mục tiêu:** đề xuất → dry-run → diff → xác nhận → apply → read-back → audit → outcome/undo.

**Gate:** không tự động hóa thay đổi rủi ro cao nếu thiếu approval; giới hạn phạm vi, rate limit và rollback.

## Thứ tự thực thi

1. Hoàn tất Gate Giai đoạn 1.
2. Thực thi Giai đoạn 2 và hoàn tất Gate.
3. Tiếp tục tuần tự đến Giai đoạn 9.
4. Mỗi lần chuyển gate phải ghi lại test evidence và thay đổi thực tế.
