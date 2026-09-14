
import { Bot, webhookCallback, Context } from "grammy";

// ─── نوع Env ───
export interface Env {
  BOT_TOKEN: string;
  MP3_URL: string;
  WELCOME_TEXT: string;
  MP3_CAPTION?: string;
}

// ─── کش سراسری برای Bot (Lazy Init) ───
// در Cloudflare Workers هر isolate ممکن است چند بار ساخته شود،
// ولی این باعث می‌شود در درخواست‌های متوالی روی یک isolate، Bot فقط یک‌بار ساخته شود.
let cachedBot: Bot | null = null;
let cachedToken: string | null = null;

function getBot(env: Env): Bot {
  // اگر توکن تغییر کرده یا Bot ساخته نشده، از نو بساز
  if (cachedBot && cachedToken === env.BOT_TOKEN) {
    return cachedBot;
  }

  const bot = new Bot(env.BOT_TOKEN);

  // ─── خوش‌آمد به اعضای جدید ───
  bot.on("message:new_chat_members", async (ctx) => {
    const newMembers = ctx.message.new_chat_members;

    // فیلتر ربات‌ها (خود ربات و ربات‌های دیگر)
    const realMembers = newMembers.filter((m) => !m.is_bot);
    if (realMembers.length === 0) return;

    // ─── ساخت نام‌های امن برای HTML ───
    const namesHtml = realMembers
      .map(
        (m) =>
          `<a href="tg://user?id=${m.id}">${escapeHtml(m.first_name)}</a>`
      )
      .join("، ");

    // ─── ساخت متن از Template ───
    const welcomeText = (env.WELCOME_TEXT || "🎉 خوش آمدی {names}!")
      .replace(/{names}/g, namesHtml)
      .replace(/{count}/g, String(realMembers.length));

    try {
      // 1. پیام خوش‌آمد
      await ctx.reply(welcomeText, {
        parse_mode: "HTML",
        reply_to_message_id: ctx.message.message_id,
        link_preview_options: { is_disabled: true },
      });

      // 2. فایل MP3
      await ctx.replyWithAudio(env.MP3_URL, {
        caption: env.MP3_CAPTION ?? "",
        title: "Welcome",
        performer: "Group Bot",
      });
    } catch (err) {
      // اگر ارسال MP3 خطا داد، حداقل خوش‌آمد ارسال شده
      console.error("Failed to send welcome sequence:", err);
    }
  });

  // ─── دستور /start (برای تست در چت خصوصی) ───
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "سلام! من رو به گروه اضافه کن و ادمین کن تا کارم رو انجام بدم 🚀"
    );
  });

  // ─── هندل خطاها ───
  bot.catch((err) => {
    console.error("Bot error:", err.error);
  });

  cachedBot = bot;
  cachedToken = env.BOT_TOKEN;
  return bot;
}

// ─── Escape کردن HTML (مهم برای امنیت و درستی Markup) ───
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Handler اصلی Worker ───
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    // فقط POST (webhook تلگرام)
    if (request.method !== "POST") {
      return new Response("Welcome Bot is running ✅", { status: 200 });
    }

    // بررسی سریع مسیر (اختیاری ولی برای امنیت خوبه)
    // می‌تونی از یک path مخفی مثل /webhook/<random> استفاده کنی
    const url = new URL(request.url);
    if (url.pathname !== "/webhook" && url.pathname !== "/") {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const bot = getBot(env);
      const handleUpdate = webhookCallback(bot, "cloudflare-mod");
      return await handleUpdate(request);
    } catch (err) {
      console.error("Worker error:", err);
      return new Response("Error", { status: 500 });
    }
  },
};
