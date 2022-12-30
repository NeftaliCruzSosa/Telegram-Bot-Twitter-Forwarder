const { Telegraf } = require("telegraf");
const { Worker } = require("worker_threads");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

const User = require("./user.model");
const { type } = require("os");
let actualWorker = {};
dotenv.config();

const TOKEN = process.env.TOKEN;
const DB_URL = process.env.DB_URL;

const bot = new Telegraf(TOKEN);
let step = "";

const connectDb = async () => {
  try {
    await mongoose.connect(DB_URL);
  } catch (error) {
    console.log("Error conectando a la base de datos:", error);
  }
};

connectDb();

async function getConfiguration(chatId) {
  const config = await User.findOne({ chatId });
  return config;
}

async function saveConfiguration(chatId, config) {
  const user = await User.findOne({ chatId });
  if (user) config._id = user._id;
  const newConfig = new User(config);
  await newConfig.save((err) => {
    if (err) console.error(err);
  });
}

async function startThread(config, ctx) {
  let member = false;
  try {
    await bot.telegram.getChatMember(ctx.message.text, ctx.botInfo.id).catch();
    member = true;
  } catch {}
  if (member) {
    const user = config.twitterProfile;
    const worker = new Worker("./tweetListener.js", {
      workerData: {
        user,
      },
    });
    actualWorker = { ...actualWorker, [config.chatId]: worker };
    worker.on("message", (result) => {
      const user = config.twitterProfile;
      const tweet = result.data.text;
      bot.telegram.sendMessage(
        config.telegramGroup,
        `${user} acaba de postear el siguiente tweet\n<-------------------------------->\n${tweet}\n<-------------------------------->\n${config.message}`
      );
    });
  } else {
    ctx.sendMessage("Bot must be an admin of the group to which you want to forward the message");
  }
}

bot.command("start", async (ctx) => {
  if (ctx.message.chat.type === "private") {
    ctx.sendMessage(
      "Welcome to TwitterForwarderBot!\n\nSet everything before run the bot\nThe commands that I have available are the following",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Set Twitter Profile",
                callback_data: "setProfile",
              },
              {
                text: "Set Telegram Group",
                callback_data: "setGroup",
              },
              {
                text: "Set Message",
                callback_data: "setMessage",
              },
              {
                text: "Start Bot",
                callback_data: "startBot",
              },
              {
                text: "Show Configuration",
                callback_data: "showConfig",
              },
            ],
          ],
        },
      }
    );
  }
});

bot.on("message", async (ctx) => {
  if (ctx.message.chat.type === "private") {
    const chatId = ctx.chat.id;
    let config = await getConfiguration(chatId);
    if (!config) {
      config = {};
      config.chatId = chatId;
      config.twitterProfile = null;
      config.telegramGroup = null;
      config.message = null;
      config.thread = null;
    }
    switch (step) {
      case "twitterProfile":
        config.twitterProfile = ctx.message.text;
        ctx.reply(`The Twitter profile that we are going to listen to is -> @${ctx.message.text}`);
        saveConfiguration(chatId, config);
        step = "";
        break;
      case "telegramGroup":
        const regex = /^-100[0-9]{10}/gm;
        const test = regex.test(ctx.message.text);
        if (!test) {
          ctx.reply(`You must send an ID`);
        } else {
          config.telegramGroup = ctx.message.text;
          ctx.reply(`Tweets will be sent to Telegram group with ID -> ${config.telegramGroup}`);
          saveConfiguration(chatId, config);
          step = "";
        }
        break;
      case "message":
        config.message = ctx.message.text;
        ctx.reply(`The message that will be sent along with each tweet is -> ${config.message}`);
        saveConfiguration(chatId, config);
        step = "";
        break;

      default:
        if (config && !config.thread) {
          ctx.reply(`I do not understand your message, the options are the following`, {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Set Twitter Profile",
                    callback_data: "setProfile",
                  },
                  {
                    text: "Set Telegram Group",
                    callback_data: "setGroup",
                  },
                  {
                    text: "Set Message",
                    callback_data: "setMessage",
                  },
                  {
                    text: "Start Bot",
                    callback_data: "startBot",
                  },
                  {
                    text: "Show Configuration",
                    callback_data: "showConfig",
                  },
                ],
              ],
            },
          });
        } else {
          ctx.reply(`I do not understand your message, the options are the following`, {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Stop Bot",
                    callback_data: "stopBot",
                  },
                ],
              ],
            },
          });
        }
        break;
    }
  }
});

bot.action("setProfile", (ctx) => {
  ctx.sendMessage("Please send the Twitter username you want to hear (wo @)");
  step = "twitterProfile";
});

bot.action("setGroup", (ctx) => {
  ctx.sendMessage(
    "Please, send the ID of the Telegram group you want to send the tweets to\n The group id must start with -100"
  );
  step = "telegramGroup";
});

bot.action("setMessage", (ctx) => {
  ctx.sendMessage("Please send the message you want to send along with each tweet");
  step = "message";
});

bot.action("showConfig", async (ctx) => {
  const chatId = ctx.chat.id;
  let config = await getConfiguration(chatId);
  if (config) {
    ctx.sendMessage(
      `The current configuration is as follows:\nTwitter Profile -> ${config.twitterProfile}\nTelegram Group -> ${config.telegramGroup}\nMessage -> ${config.message}`
    );
  } else {
    ctx.sendMessage(`You haven't configured the bot options yet`);
  }
});

bot.action("startBot", async (ctx) => {
  const chatId = ctx.chat.id;
  let config = await getConfiguration(chatId);
  if (config) {
    if (config.twitterProfile && config.telegramGroup && config.message) {
      if (actualWorker.hasOwnProperty(config.chatId)) {
        const worker = actualWorker[config.chatId];
        worker.terminate();
      }
      startThread(config, ctx);
      if(actualWorker.hasOwnProperty(config.chatId)){
      config.thread = true;
      ctx.reply(
        "The bot has been successfully configured and is listening for tweets from the specified Twitter profile."
      );}
    } else {
      ctx.reply("The bot cannot be started until all configuration options are set.");
    }
    saveConfiguration(chatId, config);
  } else {
    ctx.reply("The bot cannot be started until all configuration options are set.");
  }
});

bot.action("stopBot", async (ctx) => {
  const chatId = ctx.chat.id;
  let config = await getConfiguration(chatId);
  if (actualWorker.hasOwnProperty(config.chatId)) {
    const worker = actualWorker[config.chatId];
    worker.terminate();
    config.thread = null;
    saveConfiguration(chatId, config);
    ctx.reply("The bot has been stopped");
  } else if (config.thread) {
    config.thread = null;
    saveConfiguration(chatId, config);
    ctx.reply("It seems that the bot was closed without finishing the previous execution");
  } else {
    ctx.reply("There are no bots running at the moment");
  }
});

bot.launch();
