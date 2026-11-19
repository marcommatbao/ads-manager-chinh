# Yêu cầu lấy dữ liệu Odoo — AdsCommand

**Đối tượng:** Dev phụ trách kết nối dữ liệu Odoo  
**Phạm vi:** Chỉ 3 nhóm dữ liệu cần cho Dashboard/P&L và Attribution campaign.  
**Không thuộc phạm vi:** `crm.lead`, `opportunity_id`, COGS, refund ledger riêng, email, phone.

## Mục tiêu

Cần xác nhận và lấy:

1. Doanh thu MBC từ Report API.
2. Số đơn đã thanh toán của MBI từ Report API.
3. Campaign gắn với từng đơn hàng.

---

## 1. Doanh thu MBC từ Report API

### Endpoint

```text
/api/Report/count-revenue
```

### Filter đang dùng

```json
{
  "typeId": [6, 9],
  "dateFrom": "YYYY-MM-DD HH:mm:ss",
  "dateTo": "YYYY-MM-DD HH:mm:ss"
}
```

### Response cần lấy

```json
{
  "data": {
    "totalRevenue": 0,
    "totalCount": 0
  }
}
```

### Mapping

```text
MBC revenue     = data.totalRevenue
MBC order count = data.totalCount
```

### Dev cần xác nhận

- `typeId [6, 9]` có đúng cho MBC không?
- `totalRevenue` là loại doanh thu nào?
- `totalCount` là số đơn hay số dòng doanh thu?
- `dateFrom/dateTo` dùng timezone nào?
- Response khi không có dữ liệu là `0`, rỗng hay lỗi?

### File source cần đối chiếu

- [lib/finance/company-pnl.ts](../lib/finance/company-pnl.ts) — `fetchMbcRevenueTruth()` và filter MBC.
- [app/api/finance/company-pnl/route.ts](../app/api/finance/company-pnl/route.ts) — API P&L có auth và company scope.

---

## 2. Số đơn đã thanh toán của MBI từ Report API

### Endpoint

```text
/api/Report/count-sale-order-paid
```

### Filter đang dùng

```json
{
  "typeId": [11, 4, 5, 2, 3, 1, 9, 6, 10],
  "teamId": [60, 59, 39, 35, 53, 42, 54, 50],
  "customerSource": [17, 29, 16, 27, 243, 30],
  "dateOrderFrom": "YYYY-MM-DD HH:mm:ss",
  "dateOrderTo": "YYYY-MM-DD HH:mm:ss"
}
```

### Response cần lấy

```json
{
  "data": 0
}
```

### Mapping

```text
MBI paid orders = data
```

### Dev cần xác nhận

- `data` có đúng là số đơn đã thanh toán không?
- Các filter `typeId`, `teamId`, `customerSource` còn đúng không?
- Đơn nháp/hủy có bị loại không?
- Đơn hoàn tiền có được xử lý như thế nào trong số đếm?
- `dateOrderFrom/dateOrderTo` dùng timezone nào?
- Response khi không có dữ liệu là `0`, rỗng hay lỗi?

### File source cần đối chiếu

- [lib/finance/company-pnl.ts](../lib/finance/company-pnl.ts) — `fetchMbiOrdersTruth()` và filter MBI.
- [app/api/finance/company-pnl/route.ts](../app/api/finance/company-pnl/route.ts) — API P&L có auth và company scope.

---

## 3. Campaign của đơn hàng

### Model đơn hàng

```text
sale.order
```

### Field cần lấy

```text
id
name
date_order
state
amount_untaxed
amount_total
campaign_id
company_id
```

### Quan hệ campaign

```text
sale.order.campaign_id → utm.campaign.id
```

### Model campaign

```text
utm.campaign
```

### Field campaign

```text
id
name
active
```

### Dữ liệu cần tạo

```text
order_id
order_name
order_date
company
order_amount
campaign_id
campaign_name
```

### Quy tắc

- Đơn có `campaign_id`: nối sang `utm.campaign.name`.
- Đơn không có `campaign_id`: ghi `unmatched`.
- Không gán doanh thu của đơn unmatched vào campaign khác.
- Không dùng Lead/opportunity trong phạm vi này.

### Dev cần xác nhận

- `campaign_id` có tồn tại trên `sale.order` không?
- Có nối được tới `utm.campaign` không?
- `utm.campaign.name` có phải tên campaign cần hiển thị không?
- Có đơn có campaign ID nhưng campaign đã bị xóa/không đọc được không?
- Có cần tách kết quả theo company không?

### File source cần đối chiếu

- [lib/campaign-revenue.ts](../lib/campaign-revenue.ts) — group đơn theo `campaign_id`, tính orders/revenue/AOV và unmatched.
- [app/api/audience/campaign-revenue/route.ts](../app/api/audience/campaign-revenue/route.ts) — API campaign revenue có auth/company scope/date validation.
- [app/(dashboard)/revenue-attribution/page.tsx](../app/(dashboard)/revenue-attribution/page.tsx) — màn hình sử dụng API campaign revenue.

---

## 4. Kết quả cần đối chiếu

| Chỉ số | Nguồn |
|---|---|
| Doanh thu MBC | Report API `count-revenue` |
| Số đơn MBC | Report API `count-revenue` |
| Số đơn MBI đã thanh toán | Report API `count-sale-order-paid` |
| Đơn có campaign | `sale.order.campaign_id` |
| Đơn không có campaign | `sale.order` với `campaign_id = false` |
| Doanh thu theo campaign | `sale.order` + `utm.campaign` |

### Tỷ lệ cần tính

```text
campaign_match_rate = orders_with_campaign / total_orders
```

Cần báo riêng:

```text
orders_with_campaign
orders_without_campaign
revenue_with_campaign
revenue_without_campaign
```

---

## 5. Mẫu thông tin Dev cần gửi lại

```text
1. Report doanh thu MBC
   - Endpoint:
   - Filter:
   - Field doanh thu:
   - Field số lượng:
   - Timezone:
   - Ví dụ response đã che dữ liệu nhạy cảm:

2. Report đơn MBI
   - Endpoint:
   - Filter:
   - Field số đơn:
   - Định nghĩa “đã thanh toán”:
   - Timezone:
   - Ví dụ response đã che dữ liệu nhạy cảm:

3. Campaign của đơn
   - sale.order.campaign_id: có/không
   - Model đích:
   - Field tên campaign:
   - Đơn không có campaign xử lý thế nào:
   - Ví dụ 1–2 dòng đã ẩn dữ liệu nhạy cảm:
```

## Không gửi

- Token/password.
- Email hoặc số điện thoại khách hàng.
- File dump dữ liệu thật.
- Thông tin đăng nhập Odoo.

**Kết luận:** Chỉ cần xác nhận 3 luồng: `count-revenue`, `count-sale-order-paid`, và `sale.order.campaign_id → utm.campaign`. Lead/opportunity, COGS và refund không nằm trong tài liệu này.
