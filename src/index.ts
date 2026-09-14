import { Bot, webhookCallback } from "grammy";
import { MemberCounter } from "./counter";

export { MemberCounter };

// ─── Env ───
export interface Env {
  BOT_TOKEN: string;
  MP3_URL: string;
  WELCOME_TEXT: string;
  GOODBYE_TEXT: string;
  MP3_CAPTION?: string;
  WEBHOOK_PATH: string;
  MEMBER_COUNTER: DurableObjectNamespace;
}

// ─── کش Bot ───
let cachedBot: Bot | null = null;
let cachedToken: string | null = null;

// ─── دسترسی به شمارنده هر گروه ───
function getCounter(env: Env, chatId: number): DurableObjectStub {
  // chat_id رو به صورت رشته تبدیل می‌کنیم و ازش ID می‌سازیم
  const id = env.MEMBER_COUNTER.idFromName(`chat_${chatId}`);
  return env.MEMBER_COUNTER.get(id);
}

async function getCount(env: Env, chatId: number): Promise<number> {
  const stub = getCounter(env, chatId);
  const res = await stub.fetch("https://do/?action=get");
  const data = (await res.json()) as { count: number };
  return data.count;
}

async function changeCount(
  env: Env,
  chatId: number,
  action: "inc" | "dec" | "set" | "reset",
  value = 1
): Promise<number> {
  const stub = getCounter(env, chatId);
  let url = `https://do/?action=${action}`;
  if (action === "inc" || action === "dec") url += `&amount=${value}`;
  if (action === "set") url += `&value=${value}`;

  const res = await stub.fetch(url);
  const data = (await res.json()) as { count: number };
  return data.count;
}

// ─── Escape HTML ───
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── ساخت Bot ───
function getBot(env: Env): Bot {
  if (cachedBot && cachedToken === env.BOT_TOKEN) return cachedBot;

  const bot = new Bot(env.BOT_TOKEN);

  // ─── ورود اعضای جدید ───
  bot.on("message:new_chat_members", async (ctx) => {
    const newMembers = ctx.message.new_chat_members;
    const realMembers = newMembers.filter((m) => !m.is_bot);
    if (realMembers.length === 0) return;

    const chatId = ctx.chat.id;

    // شمارنده رو زیاد کن (به تعداد اعضای واقعی جدید)
    const newCount = await changeCount(env, chatId, "inc", realMembers.length);

    // لیست اسم‌ها
    const namesHtml = realMembers
      .map(
        (m) =>
          `<a href="tg://user?id=${m.id}">${escapeHtml(m.first_name)}</a>`
      )
      .join("، ");

    // متن خوش‌آمد با جایگزینی {names} و {count}
    const welcomeText = (env.WELCOME_TEXT || "🎉 خوش آمدی {names}!")
      .replace(/{names}/g, namesHtml)
      .replace(/{count}/g, String(newCount));

    try {
      await ctx.reply(welcomeText, {
        parse_mode: "HTML",
        reply_to_message_id: ctx.message.message_id,
        link_preview_options: { is_disabled: true },
      });

      await ctx.replyWithAudio(env.MP3_URL, {
        caption: env.MP3_CAPTION ?? "",
        title: "Welcome",
        performer: "Group Bot",
      });
    } catch (err) {
      console.error("Welcome sequence failed:", err);
    }
  });

  // ─── خروج اعضا ───
  bot.on("message:left_chat_member", async (ctx) => {
    const member = ctx.message.left_chat_member;
    if (!member || member.is_bot) return; // ربات‌ها رو نشمار

    const chatId = ctx.chat.id;
    const newCount = await changeCount(env, chatId, "dec", 1);

    const nameHtml = escapeHtml(member.first_name);
    const goodbyeText = (env.GOODBYE_TEXT || "👋 {name} از گروه خارج شد.")
      .replace(/{name}/g, nameHtml)
      .replace(/{count}/g, String(newCount));

    try {
      await ctx.reply(goodbyeText, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch (err) {
      console.error("Goodbye message failed:", err);
    }
  });

  // ─── دستور /start ───
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "سلام! من رو به گروه اضافه کن و ادمین کن تا کارم رو انجام بدم 🚀"
    );
  });

  // ─── دستور /count — نمایش شمارنده ───
  bot.command("count", async (ctx) => {
    // فقط در گروه‌ها
    if (ctx.chat.type === "private") {
      await ctx.reply("این دستور فقط در گروه کار می‌کنه.");
      return;
    }

    const count = await getCount(env, ctx.chat.id);
    await ctx.reply(`👥 تعداد اعضای ثبت‌شده در شمارنده: <b>${count}</b>`, {
      parse_mode: "HTML",
    });
  });

  // ─── دستور /sync — همگام‌سازی با تعداد واقعی اعضا (فقط ادمین) ───
  bot.command("sync", async (ctx) => {
    if (ctx.chat.type === "private") {
      await ctx.reply("این دستور فقط در گروه کار می‌کنه.");
      return;
    }

    // بررسی ادمین بودن فرستنده
    try {
      const member = await ctx.getAuthor();
      if (member.status !== "administrator" && member.status !== "creator") {
        await ctx.reply("⛔ فقط ادمین‌ها می‌تونن این دستور رو بزنن.");
        return;
      }
    } catch {
      await ctx.reply("خطا در بررسی دسترسی.");
      return;
    }

    // شمارش اعضای واقعی گروه
    const total = await ctx.api.getChatMemberCount(ctx.chat.id);
    // تلگرام خود ربات رو هم می‌شمره؛ یک کم می‌کنیم اگه ربات عضوه
    // (برای سادگی همون total رو ذخیره می‌کنیم)
    const newCount = await changeCount(env, ctx.chat.id, "set", total);

    await ctx.reply(
      `✅ شمارنده با تعداد واقعی اعضا همگام شد: <b>${newCount}</b>`,
      { parse_mode: "HTML" }
    );
  });

  bot.catch((err) => {
    console.error("Bot error:", err.error);
  });

  cachedBot = bot;
  cachedToken = env.BOT_TOKEN;
  return bot;
}

// ─── Handler اصلی ───
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Welcome Bot is running ✅", { status: 200 });
    }

    const url = new URL(request.url);
    if (url.pathname !== env.WEBHOOK_PATH) {
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
