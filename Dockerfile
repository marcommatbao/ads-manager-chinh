FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# data/ không còn tệp seed nào được git theo dõi (data/tenants.json đã bỏ track
# 17/09/2026 vì chứa GA4 property ID + Pixel ID). Tạo thư mục rỗng để
# `COPY /app/data` ở stage runner không đứt build; app tự dựng lại nội dung từ
# biến môi trường khi khởi động (xem lib/tenants/registry.ts).
RUN mkdir -p /app/data
ENV NEXT_TELEMETRY_DISABLED=1
ARG AUTH_SECRET
ENV AUTH_SECRET=$AUTH_SECRET

# Các biến NEXT_PUBLIC_* PHẢI có mặt LÚC BUILD, không phải lúc chạy: Next nội
# suy chúng thẳng vào gói client (đo thật 17/09/2026 — giá trị sentinel xuất
# hiện trong 7 tệp .next/static, còn biến chỉ-server thì không lọt ra tệp nào).
# Đặt chúng ở nền tảng mà KHÔNG bật cờ build-time thì bản build mang chuỗi rỗng
# và giao diện hiện "chưa cấu hình" dù runtime có đủ biến.
# Trên Coolify bản này, cờ đó là `is_buildtime` (KHÔNG phải `is_build_time` —
# tên kia bị API từ chối với "This field is not allowed").
# Danh sách dưới đây phải khớp PUBLIC_ENV trong lib/meta-accounts.ts.
ARG NEXT_PUBLIC_META_PAGE_ID_MBC
ENV NEXT_PUBLIC_META_PAGE_ID_MBC=$NEXT_PUBLIC_META_PAGE_ID_MBC
ARG NEXT_PUBLIC_META_PAGE_ID_MBI
ENV NEXT_PUBLIC_META_PAGE_ID_MBI=$NEXT_PUBLIC_META_PAGE_ID_MBI
ARG NEXT_PUBLIC_META_PAGE_ID_SALE_AI
ENV NEXT_PUBLIC_META_PAGE_ID_SALE_AI=$NEXT_PUBLIC_META_PAGE_ID_SALE_AI
ARG NEXT_PUBLIC_META_PIXEL_ID_MBC
ENV NEXT_PUBLIC_META_PIXEL_ID_MBC=$NEXT_PUBLIC_META_PIXEL_ID_MBC
ARG NEXT_PUBLIC_META_PIXEL_ID_MBI
ENV NEXT_PUBLIC_META_PIXEL_ID_MBI=$NEXT_PUBLIC_META_PIXEL_ID_MBI
ARG NEXT_PUBLIC_META_PIXEL_ID_SALE_AI
ENV NEXT_PUBLIC_META_PIXEL_ID_SALE_AI=$NEXT_PUBLIC_META_PIXEL_ID_SALE_AI
ARG NEXT_PUBLIC_META_PAGE_LABEL_MBC
ENV NEXT_PUBLIC_META_PAGE_LABEL_MBC=$NEXT_PUBLIC_META_PAGE_LABEL_MBC
ARG NEXT_PUBLIC_META_PAGE_LABEL_MBI
ENV NEXT_PUBLIC_META_PAGE_LABEL_MBI=$NEXT_PUBLIC_META_PAGE_LABEL_MBI
ARG NEXT_PUBLIC_META_PAGE_LABEL_SALE_AI
ENV NEXT_PUBLIC_META_PAGE_LABEL_SALE_AI=$NEXT_PUBLIC_META_PAGE_LABEL_SALE_AI
ARG NEXT_PUBLIC_META_PIXEL_LABEL_MBC
ENV NEXT_PUBLIC_META_PIXEL_LABEL_MBC=$NEXT_PUBLIC_META_PIXEL_LABEL_MBC
ARG NEXT_PUBLIC_META_PIXEL_LABEL_MBI
ENV NEXT_PUBLIC_META_PIXEL_LABEL_MBI=$NEXT_PUBLIC_META_PIXEL_LABEL_MBI
ARG NEXT_PUBLIC_META_PIXEL_LABEL_SALE_AI
ENV NEXT_PUBLIC_META_PIXEL_LABEL_SALE_AI=$NEXT_PUBLIC_META_PIXEL_LABEL_SALE_AI
ARG NEXT_PUBLIC_GA4_PROPERTY_ID_MBC
ENV NEXT_PUBLIC_GA4_PROPERTY_ID_MBC=$NEXT_PUBLIC_GA4_PROPERTY_ID_MBC
ARG NEXT_PUBLIC_GA4_PROPERTY_ID_MBI
ENV NEXT_PUBLIC_GA4_PROPERTY_ID_MBI=$NEXT_PUBLIC_GA4_PROPERTY_ID_MBI
ARG NEXT_PUBLIC_GA4_PROPERTY_ID_SALE_AI
ENV NEXT_PUBLIC_GA4_PROPERTY_ID_SALE_AI=$NEXT_PUBLIC_GA4_PROPERTY_ID_SALE_AI
ARG NEXT_PUBLIC_GA4_STREAM_ID_MBC
ENV NEXT_PUBLIC_GA4_STREAM_ID_MBC=$NEXT_PUBLIC_GA4_STREAM_ID_MBC
ARG NEXT_PUBLIC_GA4_STREAM_ID_MBI
ENV NEXT_PUBLIC_GA4_STREAM_ID_MBI=$NEXT_PUBLIC_GA4_STREAM_ID_MBI
ARG NEXT_PUBLIC_GA4_STREAM_ID_SALE_AI
ENV NEXT_PUBLIC_GA4_STREAM_ID_SALE_AI=$NEXT_PUBLIC_GA4_STREAM_ID_SALE_AI
ARG NEXT_PUBLIC_GA4_MEASUREMENT_ID_MBC
ENV NEXT_PUBLIC_GA4_MEASUREMENT_ID_MBC=$NEXT_PUBLIC_GA4_MEASUREMENT_ID_MBC
ARG NEXT_PUBLIC_GA4_MEASUREMENT_ID_MBI
ENV NEXT_PUBLIC_GA4_MEASUREMENT_ID_MBI=$NEXT_PUBLIC_GA4_MEASUREMENT_ID_MBI
ARG NEXT_PUBLIC_GA4_MEASUREMENT_ID_SALE_AI
ENV NEXT_PUBLIC_GA4_MEASUREMENT_ID_SALE_AI=$NEXT_PUBLIC_GA4_MEASUREMENT_ID_SALE_AI

RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache curl dcron su-exec && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/data ./data
COPY --from=builder --chown=nextjs:nodejs /app/certs ./certs

# Crontab is generated at runtime by docker-entrypoint.sh.
# crond must run as root; entrypoint drops to nextjs for node via su-exec.
RUN mkdir -p /app/crontabs && chown -R nextjs:nodejs /app/crontabs
ENV CRON_SPOOL_DIR=/app/crontabs

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["/app/docker-entrypoint.sh"]
