import TelegramBot from "node-telegram-bot-api";


export function createTelegramBot(token) {
  const bot = new TelegramBot(token, { polling: true });

  bot.on("message", (msg) => {
    bot.sendMessage(msg.chat.id, "Бот на связи 🚀");
  });

  return bot;
}

