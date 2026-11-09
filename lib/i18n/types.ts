// Bản dịch phải có ĐỦ mọi khoá của bản tiếng Việt (gốc) và không thừa khoá: thiếu/thừa là TypeScript báo lỗi, build đỏ.
export type Translation<T> = { readonly [K in keyof T]: string }
