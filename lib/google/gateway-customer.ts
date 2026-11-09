// ============================================================
// Customer của google-ads-api lấy access token từ CỔNG thay vì tự đổi refresh token bằng client secret.
// Đã kiểm thật (spike #6946, 22/10/2026, tài khoản Mắt Bão): REST query, gRPC listAccessibleCustomers, gRPC mutate
// validate_only đều chạy; bẫy gài vào OAuth2Client/UserRefreshClient = 0 lần chạm. Không vá node_modules.
// ============================================================
import { Customer } from "google-ads-api"
import { grpc } from "google-gax"

type TokenProvider = () => Promise<string>

export class GatewayCustomer extends Customer {
  private readonly tokenProvider: TokenProvider

  constructor(opts: { customerId: string; loginCustomerId?: string; cacheKey: string }, tokenProvider: TokenProvider) {
    // client_secret / refresh_token cố ý để GIẢ: thư viện không được dùng tới (đã kiểm ở spike). refresh_token còn làm
    // khoá cache serviceCache của thư viện → đặt theo kết nối ở cổng.
    super(
      { client_id: "mb-connect", client_secret: "NOT-USED", developer_token: undefined as unknown as string },
      { customer_id: opts.customerId, login_customer_id: opts.loginCustomerId, refresh_token: `gw:${opts.cacheKey}` },
    )
    this.tokenProvider = tokenProvider
    // gRPC (mutate, CustomerService.listAccessibleCustomers): getCredentials là `private` trong kiểu của thư viện nên gán đè
    // lúc chạy (cùng hành vi spike). grpc-js gọi getRequestHeaders mỗi lượt → token luôn mới.
    ;(this as unknown as { getCredentials: () => unknown }).getCredentials = () =>
      grpc.credentials.combineChannelCredentials(
        grpc.credentials.createSsl(),
        grpc.credentials.createFromGoogleCredential({
          getRequestHeaders: async () => ({ authorization: `Bearer ${await tokenProvider()}` }),
        } as never),
      )
  }

  // REST (query / report)
  async getAccessToken(): Promise<string> {
    return this.tokenProvider()
  }
}
