import TelegramBot from "node-telegram-bot-api";

export function createTelegramBot(token) {
  if (!token) {
    console.warn("⚠️ TG_TOKEN not provided, Telegram bot disabled. Messages will be logged to console.");
    return {
      sendMessage: async (chatId, message) => {
        console.log(`[Telegram Mock] to ${chatId}:\n${message}`);
      },
      on: () => { }
    };
  }
  const bot = new TelegramBot(token, { polling: true });

  // bot.on("message", (msg) => {
  //   bot.sendMessage(msg.chat.id, "Бот на связи 🚀");
  // });

  return bot;
}
