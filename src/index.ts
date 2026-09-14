import { Bot, webhookCallback, InlineKeyboard } from "grammy";

// ─── تعریف Env برای دسترسی به Secrets و Variables کلودفلر ───
export interface Env {
  BOT_TOKEN: string;
  MP3_URL: string;      // آدرس فایل MP3 (مثلاً در R2 یا هر جای دیگه)
  WELCOME_TEXT?: string; // متن خوش‌آمدگویی (اختیاری)
}

// ─── ساخت ربات با توکن ───
function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  // دستور /start برای تست در چت خصوصی
  bot.command("start", async (ctx) => {
    await ctx.reply("سلام! من رو به گروه اضافه کن و ادمین کن تا کارم رو انجام بدم 🚀");
  });

  // ─── رویداد ورود اعضای جدید ───
  bot.on("message:new_chat_members", async (ctx) => {
    const newMembers = ctx.message.new_chat_members;

    // فیلتر کردن خود ربات (وقتی خود ربات به گروه اضافه می‌شه)
    const realMembers = newMembers.filter((m) => !m.is_bot);

    if (realMembers.length === 0) return;

    // ساخت لیست نام‌ها
    const names = realMembers
      .map((m) => `[${m.first_name}](tg://user?id=${m.id})`)
      .join("، ");

    // متن خوش‌آمدگویی (از env یا پیش‌فرض)
    const welcomeText =
      env.WELCOME_TEXT ??
      `🎉 خوش آمدی ${names} عزیز!\n\nامیدوارم اوقات خوبی رو اینجا داشته باشی 🌹`;

    try {
      // 1. ارسال پیام خوش‌آمدگویی
      await ctx.reply(welcomeText, {
        parse_mode: "Markdown",
        reply_to_message_id: ctx.message.message_id,
      });

      // 2. ارسال فایل MP3 بعد از خوش‌آمدگویی
      await ctx.replyWithAudio(env.MP3_URL, {
        caption: "🎵 این هم یک هدیه کوچیک از طرف ما!",
        title: "Welcome",
        performer: "Group Bot",
      });
    } catch (err) {
      console.error("خطا در ارسال پیام:", err);
    }
  });

  // ─── مدیریت خطاها (اختیاری ولی توصیه می‌شه) ───
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return bot;
}

// ─── Handler اصلی Cloudflare Worker ───
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // فقط POST رو قبول کن (تلگرام همیشه POST می‌فرسته)
    if (request.method !== "POST") {
      return new Response("Welcome Bot is running ✅", { status: 200 });
    }

    try {
      const bot = createBot(env);
      const handleUpdate = webhookCallback(bot, "cloudflare-mod");

      return await handleUpdate(request);
    } catch (err) {
      console.error("Worker error:", err);
      return new Response("Error", { status: 500 });
    }
  },
};
