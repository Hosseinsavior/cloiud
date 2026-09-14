/**
 * Durable Object برای شمارش اعضای هر گروه.
 * هر گروه یک نمونه (Instance) مستقل دارد.
 * ID این نمونه از chat_id گرفته می‌شود.
 */
export class MemberCounter implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    // خواندن شمارنده فعلی
    let count: number = (await this.state.storage.get<number>("count")) ?? 0;

    switch (action) {
      case "get":
        break; // فقط برگردان

      case "inc": {
        const amount = Number(url.searchParams.get("amount") ?? "1");
        count += amount;
        await this.state.storage.put("count", count);
        break;
      }

      case "dec": {
        const amount = Number(url.searchParams.get("amount") ?? "1");
        count = Math.max(0, count - amount);
        await this.state.storage.put("count", count);
        break;
      }

      case "set": {
        const value = Number(url.searchParams.get("value") ?? "0");
        count = Math.max(0, value);
        await this.state.storage.put("count", count);
        break;
      }

      case "reset": {
        count = 0;
        await this.state.storage.put("count", count);
        break;
      }

      default:
        return new Response("Unknown action", { status: 400 });
    }

    return new Response(JSON.stringify({ count }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
