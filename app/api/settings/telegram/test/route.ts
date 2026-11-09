// ============================================================
// Telegram Test API
// POST /api/settings/telegram/test
// Sends a test message to verify bot + chat ID connection
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { sendTestMessage, verifyBotToken } from "@/lib/telegram";
import { getCurrentUser } from "@/lib/auth";
import { guardViewCredentials } from "@/lib/settings/guards";
import { friendlyError } from "@/lib/not-configured";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const credGuard = guardViewCredentials(user);
  if (credGuard) return credGuard;

  try {
    const body = await request.json();
    const { chat_id, bot_token } = body;

    if (!bot_token) {
      return NextResponse.json(
        { success: false, error: "Bot token is required" },
        { status: 400 }
      );
    }

    if (!chat_id) {
      return NextResponse.json(
        { success: false, error: "Chat ID is required" },
        { status: 400 }
      );
    }

    // First verify the token is valid
    const verify = await verifyBotToken(bot_token);
    if (!verify.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Bot token không hợp lệ: ${verify.error}`,
        },
        { status: 400 }
      );
    }

    // Send test message
    const result = await sendTestMessage(bot_token, chat_id);

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `Gửi thất bại: ${result.error}`,
          hint: result.error?.includes("chat not found")
            ? "Chat ID không tồn tại. Hãy nhắn /start cho bot trước."
            : undefined,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      botName: verify.botName,
      messageId: result.messageId,
      sentAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: friendlyError(message) },
      { status: 500 }
    );
  }
}
