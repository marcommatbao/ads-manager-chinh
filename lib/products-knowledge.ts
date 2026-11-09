export const PRODUCTS_KB = {

  'ten-mien': {
    name: 'Tên miền',
    brand: 'Mat Bao Corporation',
    category: 'Domain & Hosting',
    description: 'Đăng ký và quản lý tên miền .vn, .com, .net, .xyz, .cloud, .one cho doanh nghiệp Việt',

    uniqueSellingPoints: [
      'Hỗ trợ hướng dẫn setup tận tay qua Livechat/Zalo',
      'Không phí ẩn — giá công khai minh bạch',
      'Quản lý tập trung nhiều domain trên 1 dashboard',
      'Khuyến mãi Mua 1 Được 4 độc quyền',
      'Quy trình đăng ký .vn tự động 100% không giấy tờ',
      'Hỗ trợ 24/7 bằng tiếng Việt'
    ],

    topOffers: [
      'Tên Miền Thả Ga — Mua 1 Được 4',
      'Tên miền .XYZ / .CLOUD / .ONE giá ưu đãi',
      'Tặng kèm hosting/email khi mua domain'
    ],

    // ĐÂY LÀ VÀNG — từ câu hỏi thực tế của khách
    realCustomerQuestions: [
      {
        question: 'Mua domain có được tặng hosting không?',
        insight: 'Khách không chỉ mua domain — họ muốn GIẢI PHÁP WEBSITE hoàn chỉnh',
        copyAngle: 'Domain + Hosting — Tất cả trong 1 gói, setup xong trong hôm nay'
      },
      {
        question: 'Có chương trình ưu đãi hiện tại không?',
        insight: 'Khách nhạy cảm giá, luôn so sánh — cần tạo urgency và show offer rõ',
        copyAngle: 'Ưu đãi [tháng/ngày] — Tiết kiệm X% khi đăng ký hôm nay'
      },
      {
        question: 'Có được hướng dẫn làm không?',
        insight: 'Khách SỢ kỹ thuật — đây là rào cản mua hàng lớn nhất',
        copyAngle: 'Không cần biết kỹ thuật — Đội ngũ hỗ trợ setup 1-1 miễn phí'
      }
    ],

    competitors: [
      {
        name: 'PA Vietnam',
        marketPosition: 'Thương hiệu lâu đời, giá rẻ',
        adsAngle: 'Giá rẻ, khuyến mãi liên tục',
        strengths: ['Brand recognition lâu năm', 'Giá thấp'],
        weaknesses: ['UX cũ, khó dùng', 'Hỗ trợ chậm, không nhiệt tình', 'Dashboard lỗi thời'],
        targetAudience: 'SME săn giá rẻ',
        counterPosition: 'PA rẻ nhưng bạn sẽ tự mò một mình — Mat Bao có người đồng hành'
      },
      {
        name: 'Tenten.vn',
        marketPosition: 'Domain + Hosting bundle',
        adsAngle: 'Gói combo, tiết kiệm',
        strengths: ['Combo domain+hosting linh hoạt'],
        weaknesses: ['Brand yếu hơn', 'Hỗ trợ kỹ thuật chậm', 'Ít chương trình loyalty'],
        targetAudience: 'SME muốn mua gọn 1 chỗ',
        counterPosition: 'Tenten có combo nhưng không có AI hỗ trợ và hệ sinh thái Mat Bao'
      },
      {
        name: 'Nhanhoa.com',
        marketPosition: 'Hosting + Domain phổ thông',
        adsAngle: 'Rẻ, nhanh, phổ thông',
        strengths: ['Giá thấp', 'Nhiều gói lựa chọn'],
        weaknesses: ['Hỗ trợ không chuyên', 'Server hay lỗi', 'Dashboard cũ'],
        targetAudience: 'Khách mới, cá nhân, không cần tư vấn',
        counterPosition: 'Nhanhoa rẻ nhưng bạn sẽ không biết tìm ai khi gặp vấn đề'
      }
    ],

    // Whitespace — góc độ CHƯA ai đang khai thác
    competitiveWhitespace: [
      'HƯỚNG DẪN TẬN TAY — PA/Tenten/Nhanhoa đều không nói về việc hỗ trợ cài đặt',
      'HỆ SINH THÁI — Domain + Email + Chữ ký số + Microsoft 365 trong 1 nơi',
      'AI-POWERED — Tích hợp Sale.ai vào quản lý domain (lợi thế độc quyền)',
      'YÊN TÂM PHÁP LÝ — Đăng ký .vn chuẩn quy định, tự động hoá 100%'
    ],

    targetAudience: {
      age: '23-55',
      locations: ['Hồ Chí Minh', 'Hà Nội'],
      primaryPersonas: [
        {
          name: 'Chủ doanh nghiệp SME & Startup',
          age: '30-50',
          gender: 'Nam 70% / Nữ 30%',
          income: '20-100tr/tháng',
          locations: ['HCM', 'HN', 'Đà Nẵng'],
          interests: ['Quản trị kinh doanh', 'Khởi nghiệp', 'Pháp luật doanh nghiệp', 'Đầu tư', 'Thương hiệu'],
          painPoints: [
            'Sợ mất tên miền thương hiệu vào tay đối thủ',
            'Thủ tục đăng ký .vn phức tạp, không biết làm',
            'Không có team IT — cần người hỗ trợ tận tay'
          ],
          triggerMoment: 'Vừa thành lập công ty hoặc nghe tin đối thủ có website xịn hơn',
          messageHook: 'Tên công ty bạn đã có domain chưa? Đăng ký trước khi người khác lấy mất.',
          priority: 1
        },
        {
          name: 'Marketing Manager / Digital Marketer',
          age: '25-40',
          gender: 'Cân bằng 50/50',
          income: '15-40tr/tháng',
          locations: ['HCM', 'HN'],
          interests: ['Digital Marketing', 'Content Marketing', 'Quảng cáo trực tuyến', 'Thương mại điện tử'],
          painPoints: [
            'Cần landing page riêng cho từng campaign nhanh',
            'Muốn domain ngắn dễ nhớ cho ads, tracking UTM',
            'Khó tích hợp tracking khi domain không linh hoạt'
          ],
          triggerMoment: 'Chuẩn bị tung campaign mới hoặc cần micro-site cho sự kiện',
          messageHook: 'Campaign sắp ra mắt — domain riêng giúp CTR tăng 23% so với link dài.',
          priority: 2
        },
        {
          name: 'Freelancer & Web Developer',
          age: '22-35',
          gender: 'Nam 85%',
          income: '10-30tr/tháng',
          locations: ['Toàn quốc', 'tập trung thành phố lớn'],
          interests: ['WordPress', 'Web design', 'Lập trình web', 'Github', 'Digital Nomad'],
          painPoints: [
            'Cần domain giá tốt cho nhiều dự án client',
            'DNS cập nhật chậm ảnh hưởng deadline khách',
            'Hỗ trợ kỹ thuật không hiểu chuyên môn gây mất thời gian'
          ],
          triggerMoment: 'Nhận dự án mới từ client hoặc thấy deal domain giá rẻ',
          messageHook: 'Domain cho khách hàng tiếp theo — xử lý trong 5 phút, DNS live sau 1 giờ.',
          priority: 3
        }
      ]
    }
  },

  'hosting': {
    name: 'Hosting',
    brand: 'Mat Bao Corporation',
    category: 'Domain & Hosting',
    description: 'Dịch vụ Web Hosting, WordPress Hosting, Cloud Hosting tốc độ cao cho doanh nghiệp Việt',

    uniqueSellingPoints: [
      'Server đặt tại Việt Nam — tốc độ load nhanh nhất',
      'Uptime 99.9% cam kết SLA',
      'Hỗ trợ kỹ thuật 24/7 bằng tiếng Việt',
      'Tự động backup hàng ngày — không lo mất dữ liệu',
      'Tích hợp sẵn SSL miễn phí',
      'WordPress Hosting tối ưu — cài 1 click',
    ],

    topOffers: [
      'Hosting giảm 50% năm đầu',
      'Tặng domain .COM khi mua hosting 12 tháng',
      'Cloud Hosting dùng thử miễn phí 14 ngày',
    ],

    realCustomerQuestions: [
      {
        question: 'Website tôi hay bị chậm, hosting có ảnh hưởng không?',
        insight: 'Khách đang chịu đựng hosting kém chất lượng — sẵn sàng chuyển đổi',
        copyAngle: 'Website chậm 3 giây = mất 53% khách. Hosting Mat Bao load dưới 1 giây',
      },
      {
        question: 'Có hỗ trợ di chuyển website từ hosting cũ không?',
        insight: 'Khách sợ rủi ro khi chuyển hosting — cần cam kết an toàn',
        copyAngle: 'Chuyển hosting MIỄN PHÍ — đội kỹ thuật thực hiện, không downtime',
      },
      {
        question: 'Hosting có tự động backup không?',
        insight: 'Khách từng mất dữ liệu hoặc lo sợ mất — pain point lớn',
        copyAngle: 'Auto backup mỗi ngày — khôi phục 1 click nếu có sự cố',
      },
    ],

    competitors: [
      {
        name: 'AZDIGI',
        adsAngle: 'Hosting tốc độ cao, LiteSpeed',
        weaknesses: ['Giá cao hơn phân khúc', 'Support chậm vào cuối tuần', 'Không có hệ sinh thái đi kèm'],
        counterPosition: 'Mat Bao có hosting nhanh + hệ sinh thái domain/email/CKS trong 1 nơi',
      },
      {
        name: 'Hostinger',
        adsAngle: 'Giá rẻ quốc tế, dễ dùng',
        weaknesses: ['Server nước ngoài — chậm tại VN', 'Support tiếng Anh', 'Không hóa đơn VAT'],
        counterPosition: 'Server Việt Nam — nhanh gấp 3 lần hosting nước ngoài, hỗ trợ tiếng Việt',
      },
      {
        name: 'Nhân Hòa',
        adsAngle: 'Hosting giá rẻ phổ thông',
        weaknesses: ['Server hay lỗi', 'Giao diện quản lý cũ', 'Hỗ trợ kỹ thuật chậm'],
        counterPosition: 'Nhân Hòa rẻ nhưng downtime = mất khách. Mat Bao cam kết uptime 99.9%',
      },
    ],

    competitiveWhitespace: [
      'MANAGED WORDPRESS — Hosting tối ưu riêng cho WordPress, đối thủ chưa tập trung',
      'HỆ SINH THÁI TOÀN DIỆN — Hosting + Domain + Email + CKS tại Mat Bao',
      'MIGRATION MIỄN PHÍ — PA/AZDIGI tính phí hoặc không hỗ trợ chuyển hosting',
    ],

    targetAudience: {
      age: '25-55',
      locations: ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng'],
      primaryPersonas: [
        {
          name: 'Chủ SME cần website kinh doanh',
          age: '30-50',
          gender: 'Nam 65% / Nữ 35%',
          income: '20-80tr/tháng',
          locations: ['HCM', 'HN', 'Đà Nẵng'],
          interests: ['Kinh doanh online', 'Thương mại điện tử', 'Website', 'WordPress'],
          painPoints: [
            'Website chậm mất khách hàng',
            'Hosting cũ hay downtime vào giờ cao điểm',
            'Không có team IT để quản lý server',
          ],
          triggerMoment: 'Website bị sập trong đợt chạy quảng cáo hoặc khuyến mãi lớn',
          messageHook: 'Website chậm 3 giây = mất 53% khách. Đừng để hosting kéo lùi doanh thu.',
          priority: 1,
        },
        {
          name: 'Freelancer / Web Developer',
          age: '22-35',
          gender: 'Nam 80%',
          income: '10-30tr/tháng',
          locations: ['Toàn quốc'],
          interests: ['WordPress', 'Web development', 'Lập trình', 'cPanel'],
          painPoints: [
            'Cần hosting ổn định cho nhiều dự án client',
            'Giá hosting tăng khi lưu lượng client tăng',
            'Support kỹ thuật không hiểu chuyên môn',
          ],
          triggerMoment: 'Nhận dự án mới và cần hosting nhanh, ổn định cho client',
          messageHook: 'Hosting cho dự án client — setup 5 phút, load dưới 1 giây.',
          priority: 2,
        },
      ],
    },
  },

  // Nguồn: https://www.matbao.net/hosting/vibe-hosting — đọc 26/08/2026.
  // KHÁC 'hosting' ở chỗ nào (đừng gộp hai sản phẩm): 'hosting' bán cho người
  // ĐÃ CÓ website và biết cPanel; Vibe Host bán cho người VỪA DỰNG app bằng AI
  // (Claude, ChatGPT, v0, Bolt, Lovable, Cursor…) và KHÔNG biết code — họ có
  // sẵn code, kẹt ở khâu đưa lên mạng. Đây là hai nỗi đau khác nhau, đừng dùng
  // chung câu chữ.
  'vibe-hosting': {
    name: 'Vibe Hosting',
    brand: 'Mat Bao Corporation',
    category: 'Domain & Hosting',
    description: 'Nền tảng đưa app/web dựng bằng AI lên mạng trong 3 phút — không cần biết code, mỗi site chạy trong container riêng',

    uniqueSellingPoints: [
      'Đưa web lên mạng trong 3 phút — không cần biết code',
      'Nhận thẳng code do AI sinh ra (Claude, ChatGPT, v0.dev, Bolt, Codex, Antigravity, Lovable, Cursor)',
      'Mỗi website chạy container riêng — site này lỗi không kéo site kia sập',
      'AI tự chẩn đoán lỗi và giải thích BẰNG TIẾNG VIỆT',
      'Quay lại bản cũ 1 chạm, không mất dữ liệu',
      'Kết nối GitHub, tự cấu hình DNS cho tên miền riêng',
      'SSL/HTTPS miễn phí tự động, tự backup cơ sở dữ liệu',
      'Hỗ trợ tiếng Việt 24/7',
    ],

    topOffers: [
      'Giảm 20% tới 30/09/2026 — Starter 63.200đ/tháng, Basic 119.200đ/tháng, Pro 232.000đ/tháng',
      'Dùng thử miễn phí 7 ngày',
      'Gói Basic bán chạy nhất — 2 CPU / 4GB RAM / 10GB, chịu được 500-1.000 đơn mỗi ngày',
    ],

    realCustomerQuestions: [
      {
        question: 'Tôi dùng AI viết xong web rồi mà không biết đưa lên mạng kiểu gì?',
        insight: 'Đây là nỗi đau LỚN NHẤT và là lý do sản phẩm tồn tại — khách có sẵn code, kẹt đúng khâu deploy',
        copyAngle: 'AI viết xong rồi? Đưa lên mạng trong 3 phút — không cần biết một dòng lệnh nào.',
      },
      {
        question: 'Không biết code thì có tự sửa được khi web lỗi không?',
        insight: 'Khách sợ lỗi xong bị kẹt vì không đọc nổi log tiếng Anh',
        copyAngle: 'Web lỗi? AI đọc log và giải thích bằng tiếng Việt. Sai thì quay lại bản cũ 1 chạm.',
      },
      {
        question: 'Hosting thường có chạy được app tôi dựng bằng AI không?',
        insight: 'Khách từng thử hosting cPanel truyền thống và thất bại — cần nói rõ đây là loại khác',
        copyAngle: 'Hosting thường sinh ra cho WordPress. Vibe Host sinh ra cho app do AI viết.',
      },
      {
        question: 'Chạy nhiều web cùng lúc có bị chậm lẫn nhau không?',
        insight: 'Freelancer chạy nhiều dự án client cùng lúc — sợ một site kéo sập cả cụm',
        copyAngle: 'Mỗi web một container riêng — 5 dự án chạy song song, không giành tài nguyên.',
      },
    ],

    competitors: [
      {
        name: 'Vercel',
        adsAngle: 'Deploy frontend nhanh, miễn phí gói cá nhân',
        weaknesses: ['Giao diện và tài liệu tiếng Anh', 'Thanh toán thẻ quốc tế', 'Không xuất hóa đơn VAT', 'Không hỗ trợ tiếng Việt', 'Vượt hạn mức là nhảy giá USD'],
        counterPosition: 'Giá tiền Việt, hóa đơn VAT, hỗ trợ tiếng Việt 24/7 — và AI báo lỗi bằng tiếng Việt',
      },
      {
        name: 'Railway / Render',
        adsAngle: 'Chạy backend + database, tính tiền theo mức dùng',
        weaknesses: ['Tính tiền theo mức dùng nên khó dự trù chi phí', 'Toàn bộ tiếng Anh', 'Server ở nước ngoài — chậm tại VN'],
        counterPosition: 'Giá cố định theo gói, biết trước phải trả bao nhiêu; máy chủ phục vụ người dùng Việt',
      },
      {
        name: 'Hosting cPanel truyền thống (AZDIGI, Nhân Hòa, Hostinger)',
        adsAngle: 'Hosting phổ thông giá rẻ',
        weaknesses: ['Sinh ra cho WordPress/PHP, app Node/Next do AI viết rất khó chạy', 'Phải tự cấu hình', 'Không có container riêng', 'Không có quay lại bản cũ'],
        counterPosition: 'Không phải rẻ hơn — mà là ĐÚNG LOẠI. Hosting thường không nhận nổi app AI vừa dựng.',
      },
    ],

    competitiveWhitespace: [
      'NGƯỜI DÙNG AI KHÔNG BIẾT CODE — chưa nhà cung cấp Việt nào nhắm hẳn vào nhóm này',
      'BÁO LỖI BẰNG TIẾNG VIỆT — Vercel/Railway đổ log tiếng Anh, người không biết code chịu thua',
      'GIÁ TIỀN VIỆT + HÓA ĐƠN VAT — nền tảng quốc tế bắt trả thẻ USD, doanh nghiệp không quyết toán được',
    ],

    targetAudience: {
      age: '22-45',
      // KHÔNG bó vào tỉnh nhỏ: người dùng công cụ AI tập trung ở HCM và Hà Nội.
      locations: ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng'],
      primaryPersonas: [
        {
          name: 'Freelancer / Designer dựng app bằng AI',
          age: '22-35',
          gender: 'Nam 70% / Nữ 30%',
          income: '10-30tr/tháng',
          locations: ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng'],
          interests: ['Web development', 'WordPress', 'Web hosting', 'Artificial intelligence', 'Software development'],
          painPoints: [
            'AI viết xong web rồi mà không biết đưa lên mạng thế nào',
            'Hosting cPanel không chạy được app Node/Next do AI sinh ra',
            'Log lỗi toàn tiếng Anh, không biết bắt đầu từ đâu',
          ],
          triggerMoment: 'Vừa dựng xong một app bằng Claude/Cursor/v0 và cần cho khách xem ngay hôm nay',
          messageHook: 'AI viết xong rồi? Đưa lên mạng trong 3 phút — không cần biết một dòng lệnh nào.',
          priority: 1,
        },
        {
          name: 'Chủ SME / Startup tự dựng công cụ nội bộ',
          age: '28-45',
          gender: 'Nam 60% / Nữ 40%',
          income: '20-60tr/tháng',
          locations: ['Hồ Chí Minh', 'Hà Nội'],
          interests: ['E-commerce', 'Small business', 'Startups', 'Artificial intelligence'],
          painPoints: [
            'Thuê dev ngoài vừa lâu vừa đắt cho một công cụ nội bộ nhỏ',
            'Không có người IT để trông máy chủ',
            'Nền tảng nước ngoài không xuất hóa đơn VAT để quyết toán',
          ],
          triggerMoment: 'Cần một landing page hoặc công cụ nội bộ gấp mà không đợi được đội kỹ thuật',
          messageHook: 'Tự dựng công cụ cho công ty bằng AI — chạy thật trong 3 phút, có hóa đơn VAT.',
          priority: 2,
        },
      ],
    },
  },

  'google-workspace': {
    name: 'Google Workspace',
    brand: 'Mat Bao Corporation (Authorized Reseller)',
    category: 'Cloud & Productivity',
    description: 'Google Workspace Business — Email doanh nghiệp @tencongty.com trên nền Gmail, tích hợp Drive, Meet, Docs, Sheets, Calendar. Đại lý ủy quyền Google tại VN, thanh toán VND, hóa đơn VAT.',
    pricingModel: 'SaaS subscription monthly/yearly — Business Starter ~175K/user/tháng, Standard ~290K, Plus ~435K',

    uniqueSellingPoints: [
      'Giao diện Gmail quen thuộc — 100% nhân viên biết dùng ngay, không cần training',
      'Google Drive từ 30GB đến không giới hạn — Shared Drives cho team',
      'Cộng tác Real-time trên Docs/Sheets/Slides — tốt nhất thị trường',
      'Google Meet HD không giới hạn — thay thế Zoom/Teams',
      'Bảo mật enterprise-grade: chống spam 99.9%, 2FA, admin console',
      'Gemini AI tích hợp sẵn — trợ lý AI viết email, tóm tắt meeting',
      'Thanh toán VND + Hóa đơn đỏ VAT qua Mat Bao',
      'Hỗ trợ migration email miễn phí từ mọi nền tảng cũ'
    ],

    topOffers: [
      'Business Starter từ 175K/user/tháng',
      'Giảm 10% khi mua năm cho 20+ users',
      'Migration email miễn phí — không mất 1 email nào',
      'Dùng thử 14 ngày miễn phí'
    ],

    realCustomerQuestions: [
      {
        question: 'Google Workspace khác gì Gmail miễn phí?',
        insight: 'Khách chưa thấy giá trị — cần show rõ ROI',
        copyAngle: 'Gmail miễn phí = không có email @congty, không quản trị được nhân viên, không Shared Drive. GWS = văn phòng số hoàn chỉnh.'
      },
      {
        question: 'So với Microsoft 365 thì nên chọn cái nào?',
        insight: 'Khách đang so sánh — cần highlight thế mạnh cộng tác',
        copyAngle: 'Team dưới 50 người, làm việc remote? GWS mượt hơn gấp 3 lần. Không cần cài app, mở browser là làm việc.'
      },
      {
        question: 'Chuyển từ email cũ sang có mất dữ liệu không?',
        insight: 'Rào cản chuyển đổi lớn nhất — sợ mất email quan trọng',
        copyAngle: 'Migration tự động giữ nguyên 100% email, danh bạ, lịch. Đội kỹ thuật Mat Bao thực hiện — 0 rủi ro.'
      }
    ],

    competitors: [
      {
        name: 'Microsoft 365',
        marketPosition: 'Dominant trong Enterprise, mạnh về Excel/desktop apps',
        adsAngle: 'Bộ Office desktop quen thuộc, bảo mật Active Directory',
        strengths: ['Excel desktop mạnh hơn Sheets cho tài chính phức tạp', 'Tích hợp sâu Windows/AD', 'Brand trust enterprise'],
        weaknesses: ['Cộng tác online chậm hơn Google', 'Setup phức tạp cần IT admin', 'Giá tăng từ 07/2026', 'Outlook nặng hơn Gmail'],
        targetAudience: 'Enterprise 50+ nhân viên, dùng nhiều Excel phức tạp',
        counterPosition: 'M365 mạnh về desktop apps — nhưng 80% SME VN chỉ cần email + drive + meeting. GWS làm tốt hơn với giá thấp hơn.'
      },
      {
        name: 'Lark (ByteDance)',
        marketPosition: 'All-in-one mới nổi, phổ biến với startup',
        adsAngle: 'Miễn phí cho team nhỏ, chat + docs + video trong 1 app',
        strengths: ['Miễn phí cho team nhỏ', 'UX hiện đại, trẻ trung', 'Tích hợp project management'],
        weaknesses: ['Không có email doanh nghiệp @congty', 'Data đặt ở nước ngoài — lo ngại bảo mật', 'Brand ByteDance (TikTok) gây nghi ngờ với enterprise', 'Không phổ biến bằng Gmail'],
        targetAudience: 'Startup tech, team nhỏ dưới 20 người',
        counterPosition: 'Lark miễn phí nhưng KHÔNG có email @congty — thiếu chuyên nghiệp khi giao dịch B2B. GWS = email + cộng tác đầy đủ.'
      },
      {
        name: 'Zoho Workplace',
        marketPosition: 'Giải pháp giá rẻ, đa tính năng',
        adsAngle: 'Rẻ hơn Google/Microsoft, nhiều tính năng',
        strengths: ['Giá thấp nhất thị trường', 'Nhiều app trong 1 suite'],
        weaknesses: ['Giao diện khó dùng', 'Ít người VN biết đến', 'Support tiếng Anh', 'Không có đại lý VN chính thức'],
        targetAudience: 'Micro-business săn giá rẻ',
        counterPosition: 'Zoho rẻ nhưng nhân viên sẽ không biết dùng — training mất thời gian. Gmail ai cũng biết.'
      }
    ],

    competitiveWhitespace: [
      'ZERO TRAINING — Nhân viên dùng Gmail cá nhân → chuyển GWS không cần học lại gì',
      'GEMINI AI TÍCH HỢP — Trợ lý AI viết email, tóm tắt meeting, phân tích data trong Sheets',
      'HÓA ĐƠN ĐỎ VND — Đối thủ quốc tế (Google trực tiếp, Zoho) không cung cấp',
      'HỆ SINH THÁI MAT BAO — GWS + Domain + Hosting + CKS trong 1 nơi',
      'MIGRATION MIỄN PHÍ — Infolinks/AgileOps tính phí, Mat Bao miễn phí 100%'
    ],

    targetAudience: {
      age: '25-50',
      locations: ['Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng'],
      primaryPersonas: [
        {
          name: 'Chủ SME / Giám đốc (10-50 nhân viên)',
          age: '30-50',
          gender: 'Nam 60% / Nữ 40%',
          income: '30-150tr/tháng',
          locations: ['HCM', 'HN', 'Đà Nẵng'],
          interests: ['Quản trị doanh nghiệp', 'Chuyển đổi số', 'Cloud computing', 'Remote work'],
          painPoints: [
            'Email @gmail gửi khách hàng/đối tác — mất uy tín',
            'Nhân viên dùng email cá nhân trao đổi công việc — không quản lý được khi nghỉ việc',
            'File công ty nằm rải rác trên USB, Zalo, email cá nhân — không tập trung'
          ],
          triggerMoment: 'Tuyển batch nhân viên mới hoặc mở thêm chi nhánh — cần email hàng loạt nhanh',
          messageHook: 'Nhân viên nghỉ việc — toàn bộ email khách hàng đi theo. GWS giúp bạn giữ lại 100% dữ liệu.',
          priority: 1
        },
        {
          name: 'Marketing Agency / Creative Team',
          age: '25-40',
          gender: 'Cân bằng 50/50',
          income: '15-60tr/tháng',
          locations: ['HCM', 'HN'],
          interests: ['Digital Marketing', 'Content Creation', 'Remote work', 'Collaboration tools'],
          painPoints: [
            'Cần cộng tác real-time trên docs/sheets với client',
            'File design nặng cần cloud storage lớn',
            'Họp online liên tục — cần Meet ổn định không giới hạn'
          ],
          triggerMoment: 'Nhận thêm client mới và cần shared workspace chuyên nghiệp',
          messageHook: 'Cộng tác với client real-time trên Google Docs — không cần gửi file qua lại qua Zalo.',
          priority: 2
        }
      ]
    }
  },

  'microsoft-365': {
    name: 'Microsoft 365',
    brand: 'Mat Bao Corporation',
    category: 'Cloud & Productivity',
    description: 'Microsoft 365 Business — Email doanh nghiệp, Office Apps, Teams, OneDrive cho SME Việt Nam. Đại lý chính hãng, thanh toán VND, hóa đơn VAT.',

    uniqueSellingPoints: [
      'Đại lý ủy quyền Microsoft chính hãng',
      'Thanh toán bằng VND — xuất hóa đơn VAT',
      'Hỗ trợ cài đặt, migration email miễn phí',
      'Email doanh nghiệp @tencongty.com chuyên nghiệp',
      'Bao gồm Word, Excel, PowerPoint, Teams, OneDrive',
      'Giá từ 79K/tháng/user — rẻ hơn mua lẻ',
    ],

    topOffers: [
      'Microsoft 365 Business Basic từ 79K/tháng',
      'Mua năm giảm thêm 15%',
      'Tặng hỗ trợ migration email miễn phí',
    ],

    realCustomerQuestions: [
      {
        question: 'Dùng Gmail miễn phí được rồi, sao phải mua M365?',
        insight: 'Khách chưa thấy giá trị — cần show ROI và chuyên nghiệp hóa',
        copyAngle: 'Email @gmail = mất điểm chuyên nghiệp. Email @congty.com + bộ Office đầy đủ từ 79K/tháng',
      },
      {
        question: 'Có hỗ trợ chuyển dữ liệu từ email cũ sang không?',
        insight: 'Rào cản chuyển đổi — sợ mất email/dữ liệu',
        copyAngle: 'Chuyển email cũ sang M365 MIỄN PHÍ — không mất 1 email nào',
      },
      {
        question: 'Khác gì so với mua Office bản quyền một lần?',
        insight: 'Khách so sánh chi phí với mua crack/bản quyền vĩnh viễn',
        copyAngle: 'M365 = Office luôn mới nhất + email doanh nghiệp + 1TB OneDrive. Crack thì không có gì ngoài rủi ro.',
      },
    ],

    competitors: [
      {
        name: 'Google Workspace',
        adsAngle: 'Dễ dùng, tích hợp Gmail',
        weaknesses: ['Không có desktop Office apps', 'Lưu trữ giới hạn', 'Ít tùy chỉnh cho enterprise'],
        counterPosition: 'Microsoft 365 có desktop apps đầy đủ + OneDrive 1TB — Google Workspace không thể thay thế',
      },
      {
        name: 'Office crack/lậu',
        adsAngle: 'Miễn phí',
        weaknesses: ['Rủi ro virus, mã độc', 'Không bảo mật', 'Không có cloud, email', 'Vi phạm bản quyền bị phạt'],
        counterPosition: 'Office lậu = rủi ro bảo mật + bị phạt hàng trăm triệu. M365 chính hãng từ 79K/tháng.',
      },
    ],

    competitiveWhitespace: [
      'THANH TOÁN VND + HÓA ĐƠN VAT — đối thủ quốc tế không có',
      'HỖ TRỢ TIẾNG VIỆT TẬN TAY — Microsoft trực tiếp không support SME nhỏ',
      'TRỌN GÓI EMAIL + OFFICE + CLOUD — giải pháp toàn diện cho SME',
    ],

    targetAudience: {
      age: '28-55',
      locations: ['Hồ Chí Minh', 'Hà Nội'],
      primaryPersonas: [
        {
          name: 'Chủ/Giám đốc SME',
          age: '30-55',
          gender: 'Nam 60% / Nữ 40%',
          income: '30-150tr/tháng',
          locations: ['HCM', 'HN', 'Đà Nẵng'],
          interests: ['Quản trị doanh nghiệp', 'Chuyển đổi số', 'Công nghệ', 'Bảo mật thông tin'],
          painPoints: [
            'Email @gmail thiếu chuyên nghiệp khi giao dịch',
            'Nhân viên dùng Office crack — rủi ro bảo mật và pháp lý',
            'Làm việc hybrid cần công cụ cộng tác online',
          ],
          triggerMoment: 'Bị đối tác hỏi tại sao dùng @gmail hoặc bị kiểm tra bản quyền phần mềm',
          messageHook: 'Email @gmail.com gửi khách hàng — bạn đang mất bao nhiêu deal vì thiếu chuyên nghiệp?',
          priority: 1,
        },
        {
          name: 'Kế toán / Admin văn phòng',
          age: '25-45',
          gender: 'Nữ 70%',
          income: '10-25tr/tháng',
          locations: ['Toàn quốc'],
          interests: ['Excel', 'Kế toán', 'Quản lý văn phòng', 'Microsoft Office'],
          painPoints: [
            'Excel crack hay lỗi, mất file',
            'Không có OneDrive — gửi file qua Zalo/USB',
            'Cần hóa đơn VAT để hạch toán chi phí',
          ],
          triggerMoment: 'File Excel quan trọng bị lỗi hoặc cần xuất hóa đơn mua phần mềm',
          messageHook: 'Excel lậu + USB = mất dữ liệu. M365 chính hãng + OneDrive 1TB từ 79K/tháng.',
          priority: 2,
        },
      ],
    },
  },

  'chu-ky-so': {
    name: 'Chữ ký số',
    brand: 'Mat Bao Corporation',
    category: 'Digital Signature & Security',
    description: 'Chữ ký số doanh nghiệp và cá nhân — ký hợp đồng, kê khai thuế, BHXH điện tử. Hỗ trợ ký USB Token và Remote Signing trên điện thoại.',

    uniqueSellingPoints: [
      'Ký từ xa trên điện thoại — không cần USB Token',
      'Đăng ký online 100% — không giấy tờ phức tạp',
      'Tích hợp mọi nền tảng: thuế, BHXH, ngân hàng, hợp đồng',
      'Hỗ trợ gia hạn tự động — không bị gián đoạn công việc',
      'Giá cạnh tranh — xuất hóa đơn VAT ngay',
      'Hỗ trợ cài đặt miễn phí qua Zalo/TeamViewer',
    ],

    topOffers: [
      'CKS doanh nghiệp từ 1.199K/năm',
      'Mua 2 năm giảm thêm 20%',
      'Remote Signing dùng thử miễn phí 7 ngày',
    ],

    realCustomerQuestions: [
      {
        question: 'CKS hết hạn thì phải làm thủ tục gì?',
        insight: 'Khách sợ thủ tục gia hạn phức tạp — pain point lớn',
        copyAngle: 'Gia hạn CKS online trong 5 phút — không cần đến văn phòng',
      },
      {
        question: 'Ký từ xa có an toàn không? Luật có chấp nhận không?',
        insight: 'Khách lo về tính pháp lý của remote signing',
        copyAngle: 'Remote Signing được Bộ TT&TT công nhận — ký mọi lúc mọi nơi, pháp lý đầy đủ',
      },
      {
        question: 'So với VNPT/Viettel CKS thì khác gì?',
        insight: 'Khách đang so sánh với brand lớn — cần show USP rõ ràng',
        copyAngle: 'Giá bằng 1/2 Viettel-CA, hỗ trợ tận tay hơn VNPT — kèm remote signing miễn phí',
      },
    ],

    competitors: [
      {
        name: 'Viettel-CA',
        adsAngle: 'Thương hiệu lớn, hạ tầng viễn thông',
        weaknesses: ['Giá cao', 'Thủ tục đăng ký lâu', 'Hỗ trợ qua tổng đài — chờ lâu'],
        counterPosition: 'Mat Bao CKS rẻ hơn 40%, đăng ký online nhanh, hỗ trợ Zalo 1-1',
      },
      {
        name: 'VNPT SmartCA',
        adsAngle: 'Remote signing tiên phong',
        weaknesses: ['App hay lỗi', 'Phải có SIM VNPT', 'Giới hạn thiết bị'],
        counterPosition: 'Remote Signing Mat Bao hoạt động trên mọi mạng, không cần SIM đặc biệt',
      },
    ],

    competitiveWhitespace: [
      'REMOTE SIGNING ĐA MẠNG — không bắt buộc SIM nhà mạng như VNPT/Viettel',
      'ĐĂNG KÝ 100% ONLINE — đối thủ vẫn yêu cầu giấy tờ/gặp mặt',
      'HỆ SINH THÁI — CKS + HĐĐT + Domain + Email doanh nghiệp trong 1 nơi',
    ],

    targetAudience: {
      age: '28-55',
      locations: ['Hồ Chí Minh', 'Hà Nội', 'Toàn quốc'],
      primaryPersonas: [
        {
          name: 'Kế toán / Giám đốc tài chính',
          age: '28-50',
          gender: 'Nữ 65% / Nam 35%',
          income: '12-50tr/tháng',
          locations: ['Toàn quốc'],
          interests: ['Kế toán', 'Thuế', 'BHXH', 'Quản lý tài chính', 'Phần mềm kế toán'],
          painPoints: [
            'CKS hết hạn bất ngờ — không nộp thuế đúng hạn',
            'USB Token hay hỏng, mất — phải làm lại mất thời gian',
            'Đi công tác không mang theo USB Token — không ký được',
          ],
          triggerMoment: 'CKS sắp hết hạn hoặc mùa quyết toán thuế đầu năm (tháng 1-3)',
          messageHook: 'CKS hết hạn = không nộp thuế được. Gia hạn online 5 phút, không gián đoạn.',
          priority: 1,
        },
        {
          name: 'Chủ doanh nghiệp mới thành lập',
          age: '25-45',
          gender: 'Nam 60% / Nữ 40%',
          income: '15-80tr/tháng',
          locations: ['HCM', 'HN'],
          interests: ['Khởi nghiệp', 'Thành lập công ty', 'Pháp luật doanh nghiệp'],
          painPoints: [
            'Mới thành lập — cần CKS để kê khai thuế ngay',
            'Không biết chọn nhà cung cấp nào',
            'Thủ tục đăng ký CKS phức tạp, sợ mất thời gian',
          ],
          triggerMoment: 'Vừa nhận giấy phép kinh doanh, cần CKS để nộp thuế lần đầu',
          messageHook: 'Vừa thành lập công ty? CKS là thứ bạn cần đầu tiên — đăng ký 100% online hôm nay.',
          priority: 2,
        },
      ],
    },
  },

  'hoa-don-dien-tu': {
    name: 'Hóa đơn điện tử',
    brand: 'Mat Bao Corporation',
    category: 'E-Invoice & Compliance',
    description: 'Phần mềm hóa đơn điện tử theo Nghị định 123/NĐ-CP — xuất hóa đơn nhanh, tích hợp API, kết nối thuế tự động.',

    uniqueSellingPoints: [
      'Tuân thủ 100% Nghị định 123/2020/NĐ-CP và Thông tư 78',
      'Xuất hóa đơn nhanh — kết nối CQT tự động',
      'API tích hợp với ERP, POS, phần mềm kế toán',
      'Giao diện tiếng Việt đơn giản — không cần training',
      'Hỗ trợ hóa đơn giá trị gia tăng và hóa đơn bán hàng',
      'Giá từ 800đ/hóa đơn — phù hợp mọi quy mô',
    ],

    topOffers: [
      'Gói 500 hóa đơn từ 400K/năm',
      'Dùng thử miễn phí 30 hóa đơn',
      'Combo HĐĐT + CKS giảm thêm 10%',
    ],

    realCustomerQuestions: [
      {
        question: 'Phần mềm HĐĐT cũ khó dùng quá, chuyển sang dễ không?',
        insight: 'Khách đang bức xúc với provider cũ — sẵn sàng chuyển đổi',
        copyAngle: 'Chuyển HĐĐT sang Mat Bao trong 1 ngày — miễn phí migration, dữ liệu giữ nguyên',
      },
      {
        question: 'Có tích hợp với phần mềm kế toán MISA/Fast không?',
        insight: 'Khách cần workflow liền mạch — API integration là key',
        copyAngle: 'Tích hợp API sẵn với MISA, Fast, SAP — xuất hóa đơn không cần nhập lại',
      },
      {
        question: 'Hóa đơn có gửi tự động cho khách hàng không?',
        insight: 'Khách muốn tự động hóa — giảm thao tác thủ công',
        copyAngle: 'Xuất hóa đơn → Gửi email/SMS tự động → Kết nối CQT. Tất cả trong 1 click.',
      },
    ],

    competitors: [
      {
        name: 'MISA meInvoice',
        adsAngle: 'Thương hiệu kế toán số 1, hệ sinh thái MISA',
        weaknesses: ['Giá cao cho SME nhỏ', 'Lock-in hệ sinh thái', 'Support chậm với gói rẻ'],
        counterPosition: 'Mat Bao HĐĐT giá bằng 1/2 MISA, API mở tích hợp mọi phần mềm — không bị lock-in',
      },
      {
        name: 'VNPT Invoice',
        adsAngle: 'Thương hiệu nhà nước, tin cậy',
        weaknesses: ['Giao diện cũ', 'API hạn chế', 'Hỗ trợ qua hotline — chờ lâu'],
        counterPosition: 'Mat Bao HĐĐT giao diện hiện đại, API đầy đủ, hỗ trợ Zalo 1-1 nhanh chóng',
      },
    ],

    competitiveWhitespace: [
      'API MỞ — Tích hợp mọi phần mềm, không bị lock-in như MISA',
      'COMBO CKS + HĐĐT — Một nơi cho cả 2 nhu cầu bắt buộc',
      'GIÁ THẤP CHO SME NHỎ — MISA/VNPT giá cao, Mat Bao từ 800đ/hóa đơn',
    ],

    targetAudience: {
      age: '25-55',
      locations: ['Toàn quốc'],
      primaryPersonas: [
        {
          name: 'Kế toán trưởng / Kế toán tổng hợp',
          age: '28-50',
          gender: 'Nữ 70% / Nam 30%',
          income: '12-35tr/tháng',
          locations: ['Toàn quốc'],
          interests: ['Kế toán', 'Thuế', 'Hóa đơn điện tử', 'MISA', 'Phần mềm kế toán'],
          painPoints: [
            'Phần mềm HĐĐT cũ hay lỗi, xuất hóa đơn chậm',
            'Không tích hợp được với phần mềm kế toán đang dùng',
            'Phải nhập tay 2 lần — phần mềm kế toán và HĐĐT',
          ],
          triggerMoment: 'Cuối tháng xuất nhiều hóa đơn mà phần mềm cũ hay lỗi',
          messageHook: 'Xuất 100 hóa đơn/tháng mà vẫn làm tay? HĐĐT tự động từ 800đ/hóa đơn.',
          priority: 1,
        },
        {
          name: 'Chủ hộ kinh doanh / DN siêu nhỏ',
          age: '30-55',
          gender: 'Nam 55% / Nữ 45%',
          income: '10-30tr/tháng',
          locations: ['Toàn quốc'],
          interests: ['Kinh doanh nhỏ', 'Thuế', 'Pháp luật doanh nghiệp'],
          painPoints: [
            'Bắt buộc dùng HĐĐT nhưng không biết chọn đâu',
            'Sợ phần mềm khó dùng, phải thuê người',
            'Ngân sách hạn chế — cần giải pháp giá rẻ',
          ],
          triggerMoment: 'Nhận thông báo bắt buộc chuyển sang HĐĐT từ cơ quan thuế',
          messageHook: 'Bắt buộc dùng HĐĐT? Đăng ký 5 phút, xuất hóa đơn ngay — từ 800đ/tờ.',
          priority: 2,
        },
      ],
    },
  },

  'khoa-hoc-thue': {
    name: 'Khóa học thuế',
    brand: 'Mat Bao Corporation',
    category: 'Education & Training',
    description: 'Khóa học kế toán thuế thực hành — từ cơ bản đến nâng cao, cập nhật chính sách mới nhất, học online mọi lúc.',

    uniqueSellingPoints: [
      'Giảng viên thực chiến — không dạy lý thuyết suông',
      'Cập nhật chính sách thuế mới nhất (NĐ, TT mới)',
      'Học online — xem lại bài giảng không giới hạn',
      'Bài tập thực hành trên phần mềm thật (MISA, HTKK)',
      'Cấp chứng chỉ hoàn thành',
      'Nhóm hỗ trợ Zalo — hỏi đáp sau khóa học',
    ],

    topOffers: [
      'Khóa thực hành thuế từ 990K',
      'Combo 3 khóa giảm 30%',
      'Học thử miễn phí buổi đầu tiên',
    ],

    realCustomerQuestions: [
      {
        question: 'Tôi mới ra trường, học xong có làm được thực tế không?',
        insight: 'Gap giữa trường học và thực tế — pain point lớn nhất',
        copyAngle: 'Ra trường 3 tháng vẫn không biết kê khai thuế? Khóa thực hành giúp bạn làm ngay.',
      },
      {
        question: 'Chính sách thuế thay đổi liên tục, học có cập nhật không?',
        insight: 'Khách sợ học kiến thức cũ — cần cam kết nội dung mới',
        copyAngle: 'Nội dung cập nhật theo NĐ/TT mới nhất 2025 — không dạy kiến thức lỗi thời',
      },
      {
        question: 'Có hỗ trợ sau khóa học không?',
        insight: 'Khách biết sẽ gặp vấn đề khi làm thực tế — cần safety net',
        copyAngle: 'Học xong vẫn được hỏi đáp trong nhóm Zalo — không bỏ bạn giữa đường',
      },
    ],

    competitors: [
      {
        name: 'Kế toán Lê Ánh',
        adsAngle: 'Trung tâm đào tạo kế toán lâu năm',
        weaknesses: ['Học offline tốn thời gian', 'Giá cao', 'Lớp đông — ít quan tâm cá nhân'],
        counterPosition: 'Mat Bao học online — xem lại không giới hạn, giá bằng 1/3 trung tâm offline',
      },
      {
        name: 'Các khóa trên Udemy/Coursera',
        adsAngle: 'Nền tảng học online quốc tế',
        weaknesses: ['Nội dung không phù hợp luật VN', 'Tiếng Anh', 'Không có support sau khóa'],
        counterPosition: 'Khóa học thuế Việt Nam, dạy trên phần mềm Việt Nam, theo luật Việt Nam',
      },
    ],

    competitiveWhitespace: [
      'HỌC ONLINE + HỖ TRỢ ZALO — trung tâm offline không có, Udemy không support',
      'THỰC HÀNH TRÊN PHẦN MỀM THẬT — MISA, HTKK, eTax — không chỉ lý thuyết',
      'CẬP NHẬT LIÊN TỤC — nội dung cập nhật theo NĐ/TT mới, không như sách giáo khoa',
    ],

    targetAudience: {
      age: '20-45',
      locations: ['Toàn quốc'],
      primaryPersonas: [
        {
          name: 'Sinh viên kế toán sắp/mới ra trường',
          age: '20-25',
          gender: 'Nữ 75% / Nam 25%',
          income: '3-10tr/tháng',
          locations: ['Toàn quốc'],
          interests: ['Kế toán', 'Tìm việc', 'Thực tập', 'Học online'],
          painPoints: [
            'Ra trường không biết kê khai thuế thực tế',
            'Phỏng vấn bị hỏi kinh nghiệm thực hành — không có',
            'Trường dạy lý thuyết, không biết dùng phần mềm',
          ],
          triggerMoment: 'Sắp phỏng vấn xin việc kế toán hoặc vừa nhận việc mới',
          messageHook: 'Có bằng kế toán nhưng chưa từng kê khai thuế thật? Khóa thực hành 2 tuần giúp bạn tự tin.',
          priority: 1,
        },
        {
          name: 'Kế toán đang đi làm cần cập nhật',
          age: '25-45',
          gender: 'Nữ 70% / Nam 30%',
          income: '8-25tr/tháng',
          locations: ['Toàn quốc'],
          interests: ['Kế toán', 'Thuế', 'Cập nhật nghề nghiệp', 'Nghị định mới'],
          painPoints: [
            'Chính sách thuế thay đổi — sợ làm sai bị phạt',
            'Không có thời gian đi học offline',
            'Cần chứng chỉ để thăng tiến hoặc đổi việc',
          ],
          triggerMoment: 'Có NĐ/TT thuế mới ban hành hoặc trước mùa quyết toán thuế',
          messageHook: 'NĐ mới về thuế 2025 — bạn đã cập nhật chưa? Khóa online 4 buổi, học ngay tối nay.',
          priority: 2,
        },
      ],
    },
  },

  'sale-ai': {
    name: 'Sale.ai',
    brand: 'Mat Bao Corporation',
    category: 'AI SaaS — Sales Automation',
    description: 'AI chatbot hỗ trợ chốt đơn, tư vấn khách hàng và trực page 24/7 cho SME, Agency và Enterprise tại Việt Nam',
    pricingModel: 'SaaS subscription monthly/yearly',

    uniqueSellingPoints: [
      'AI trực page 24/7 — không bỏ lỡ lead nào kể cả 2 giờ sáng',
      'Tự động tư vấn và chốt đơn theo kịch bản bạn định sẵn',
      'Tích hợp Facebook Messenger, Zalo, Website Widget',
      'Sản phẩm nội địa — hiểu tiếng Việt tự nhiên, không dịch máy',
      'Đội ngũ Mat Bao hỗ trợ setup và training AI',
      'Giá SaaS phù hợp SME Việt — không cần enterprise budget'
    ],

    realCustomerQuestions: [
      {
        question: 'AI có hiểu tiếng Việt đặc thù ngành của tôi không?',
        insight: 'Khách lo AI generic, không phù hợp business cụ thể',
        copyAngle: 'AI được training theo sản phẩm và ngôn ngữ của chính bạn'
      },
      {
        question: 'Setup mất bao lâu? Có cần IT không?',
        insight: 'Rào cản kỹ thuật — SME không có IT team',
        copyAngle: 'Setup trong 1 ngày làm việc — không cần biết code'
      },
      {
        question: 'So với thuê nhân viên trực page thì sao?',
        insight: 'Khách đang so sánh với chi phí nhân sự',
        copyAngle: '1 AI bằng 3 nhân viên trực — hoạt động 24/7, không nghỉ phép'
      }
    ],

    competitors: [
      {
        name: 'Hana (FPT)',
        adsAngle: 'Enterprise AI, công nghệ Việt',
        weaknesses: ['Giá cao enterprise', 'Setup phức tạp', 'Target lớn không phù hợp SME'],
        counterPosition: 'Sale.ai dành riêng cho SME — giá hợp lý, setup nhanh, hỗ trợ tận tay'
      },
      {
        name: 'Chatbot nước ngoài (Tidio, Intercom)',
        adsAngle: 'Feature-rich, global platform',
        weaknesses: ['Tiếng Việt kém', 'Giá USD đắt', 'Không có local support'],
        counterPosition: 'Made in Vietnam — hiểu văn hoá bán hàng Việt, thanh toán VND, hỗ trợ tiếng Việt'
      },
      {
        name: 'Nhân viên trực page thủ công',
        adsAngle: 'Không phải đối thủ công nghệ',
        weaknesses: ['Chi phí cao', 'Không trực 24/7', 'Thiếu nhất quán', 'Hay nghỉ việc'],
        counterPosition: 'Thay thế 3 nhân viên trực page với chi phí bằng 1/3'
      }
    ],

    targetAudience: {
      age: '25-50',
      locations: ['Hồ Chí Minh', 'Hà Nội', 'Toàn quốc'],
      primaryPersonas: [
        {
          name: 'Chủ SME bán hàng online',
          age: '28-45',
          painPoints: [
            'Mất lead vì không trực page kịp lúc 10-11 giờ đêm',
            'Nhân viên trực page trả lời không nhất quán, thiếu chuyên nghiệp',
            'Chi phí nhân sự tăng cao mà conversion không tương xứng'
          ],
          triggerMoment: 'Sau một đêm thấy 20 tin nhắn Messenger không được trả lời',
          messageHook: 'Tối qua bạn bỏ lỡ bao nhiêu đơn hàng vì không có người trực?',
          priority: 1
        },
        {
          name: 'Agency / Marketing Team',
          age: '25-40',
          painPoints: [
            'Quản lý chatbot cho nhiều client cùng lúc rất mất thời gian',
            'Cần báo cáo chuyển đổi chatbot để show ROI cho client',
            'Client muốn AI nhưng budget không đủ thuê enterprise solution'
          ],
          triggerMoment: 'Client hỏi về chatbot AI và cần giải pháp trong tầm giá SME',
          messageHook: 'Quản lý chatbot AI cho toàn bộ client từ 1 dashboard duy nhất.',
          priority: 2
        }
      ]
    }
  }
}
