// ============================================================
// Dọn dẹp khi launch Google Ads hỏng giữa chừng
// ------------------------------------------------------------
// Launch Google đi theo nhiều pha: Budget+Campaign → Geo/Ngôn ngữ → Ad Group /
// Asset Group → Keyword/Asset → RSA. Pha sau hỏng thì các pha trước ĐÃ ghi thật
// lên tài khoản Google — trước đây không có gì dọn, nên mỗi lần launch lỗi là
// để lại một campaign PAUSED rỗng cùng budget mồ côi nằm đó vĩnh viễn. Đường
// Meta (app/api/creative/launch-campaign) đã có rollback từ trước; đây là bản
// tương đương cho Google.
//
// Nguyên tắc:
//  - Xoá từ con lên cha. Xoá campaign trước rồi mới tới budget, vì budget còn
//    campaign tham chiếu thì Google từ chối xoá.
//  - Dọn hỏng KHÔNG được che mất lỗi gốc: mỗi bước tự bắt lỗi và trả về kết quả
//    để chỗ gọi nói cho người dùng biết cái gì còn sót phải xoá tay.
// ============================================================

import { describeGoogleAdsError } from "@/lib/google-ads-error";

/** Chỉ cần đúng phần mutateResources của google-ads-api customer object. */
interface MutateCapable {
  mutateResources(ops: unknown[]): Promise<unknown>;
}

export interface RollbackStep {
  entity: string;
  resourceName: string;
  ok: boolean;
  error?: string;
}

export interface RollbackOutcome {
  attempted: boolean;
  steps: RollbackStep[];
  /** Còn thứ chưa xoá được → người dùng phải vào Google Ads dọn tay. */
  leftovers: string[];
  /** Câu tóm tắt để đẩy thẳng vào log launch. */
  summary: string;
}

async function removeOne(
  customer: MutateCapable,
  entity: string,
  resourceName: string,
): Promise<RollbackStep> {
  try {
    // Hình dạng op phải là `resource: "<resource name>"`, KHÔNG phải
    // `resource_name`. Thư viện dựng lệnh bằng đúng một dòng:
    //   { [mutation.operation ?? "create"]: mutation.resource }
    // (node_modules/google-ads-api/build/src/service.js:151)
    // nên truyền `resource_name` sẽ gửi đi `{ remove: undefined }` và Google từ
    // chối cả lượt. Đây chính là lý do lượt chạy đầu của phép thử dọn được 0/2
    // và để lại campaign + budget thật trên tài khoản.
    await customer.mutateResources([{ entity, operation: "remove", resource: resourceName }]);
    return { entity, resourceName, ok: true };
  } catch (err) {
    // google-ads-api ném GoogleAdsFailure (object), không phải Error — dùng
    // String(err) ở đây thì lý do xoá hỏng biến thành "[object Object]".
    return { entity, resourceName, ok: false, error: describeGoogleAdsError(err).message };
  }
}

/**
 * Xoá những gì đã tạo được trước khi lỗi.
 * @param created Truyền theo thứ tự CON TRƯỚC CHA — hàm này xoá đúng thứ tự đó.
 */
export async function rollbackGoogleLaunch(
  customer: MutateCapable,
  created: Array<{ entity: string; resourceName: string }>,
): Promise<RollbackOutcome> {
  const real = created.filter(
    // Bỏ resource name tạm (id âm, dạng ".../-2") và chỗ chưa đọc được tên thật:
    // gửi lệnh xoá trên một cái tên bịa chỉ tạo thêm lỗi nhiễu.
    (c) => c.resourceName && !/\/-\d+$/.test(c.resourceName) && !c.resourceName.endsWith("/unknown"),
  );
  if (real.length === 0) {
    return { attempted: false, steps: [], leftovers: [], summary: "Không có gì cần dọn." };
  }

  const steps: RollbackStep[] = [];
  for (const c of real) {
    steps.push(await removeOne(customer, c.entity, c.resourceName));
  }

  const leftovers = steps.filter((s) => !s.ok).map((s) => `${s.entity} ${s.resourceName}`);
  const summary = leftovers.length === 0
    ? `Đã dọn ${steps.length} thứ vừa tạo dở — không để lại rác trên tài khoản Google.`
    : `Dọn được ${steps.length - leftovers.length}/${steps.length}. CÒN SÓT, cần xoá tay trên Google Ads: ${leftovers.join(", ")}`;

  return { attempted: true, steps, leftovers, summary };
}
