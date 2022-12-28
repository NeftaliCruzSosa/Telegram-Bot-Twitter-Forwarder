const { Telegraf } = require("telegraf");
const { Worker } = require("worker_threads");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

const User = require("./user.model");
let actualWorker = {};
dotenv.config();

const TOKEN = process.env.TOKEN;
const DB_URL = process.env.DB_URL;

const bot = new Telegraf(TOKEN);
let step = ""

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

async function startThread(config) {
  const user = config.twitterProfile;
  const worker = new Worker("./tweetListener.js", {
    workerData: {
      user,
    },
});
    actualWorker = {...actualWorker, 
        [config.chatId]: worker
    };
  worker.on("message", (result) => {
      const user = config.twitterProfile;
      const tweet = result.data.text;
      bot.telegram.sendMessage(config.telegramGroup, `${user} acaba de postear el siguiente tweet\n<-------------------------------->\n${tweet}\n<-------------------------------->\n${config.message}`);
    });
}

bot.command("start", async (ctx) => {
  if (ctx.message.chat.type === 'private'){
  ctx.sendMessage(
    "Bienvenido al bot de Twitter!",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Perfil de twitter",
              callback_data: "setProfile",
            },
            {
              text: "Grupo de telegram",
              callback_data: "setGroup",
            },
            {
              text: "Mensaje",
              callback_data: "setMessage",
            },
            {
              text: "Start Bot",
              callback_data: "startBot",
            },
            {
              text: "Mostrar Configuracion",
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
  if (ctx.message.chat.type === 'private'){
  const chatId = ctx.chat.id;
  let config = await getConfiguration(chatId);
  switch (step) {
    case "twitterProfile":
      config.twitterProfile = ctx.message.text;
      ctx.reply(`El perfil de Twitter que vamos a escuchar es @${ctx.message.text}`);
      saveConfiguration(chatId, config);
      step = "";
      break;
    case "telegramGroup":
      config.telegramGroup = ctx.message.text;
      ctx.reply(`Los tweets se enviarán al grupo de Telegram con ID ${config.telegramGroup}`);
      saveConfiguration(chatId, config);
      step = "";
      break;
    case "message":
      config.message = ctx.message.text;
      ctx.reply(`El mensaje que se enviará junto con cada tweet es: ${config.message}`);
      saveConfiguration(chatId, config);
      step = "";
      break;

    default:
        if (!config.thread){
        ctx.reply(`No entiendo tu mensaje, las opciones son las siguientes`,{
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "Perfil de twitter",
                    callback_data: "setProfile",
                  },
                  {
                    text: "Grupo de telegram",
                    callback_data: "setGroup",
                  },
                  {
                    text: "Mensaje",
                    callback_data: "setMessage",
                  },
                  {
                    text: "Start Bot",
                    callback_data: "startBot",
                  },
                  {
                    text: "Mostrar Configuracion",
                    callback_data: "showConfig",
                  },
                ],
              ],
            }});
        } else {
            ctx.reply(`No entiendo tu mensaje, las opciones son las siguientes`,{
                reply_markup: {
                  inline_keyboard: [
                    [
                      
                      {
                        text: "Stop Bot",
                        callback_data: "stopBot",
                      },
                    ],
                  ],
                }});
        }
      break;
  }
}
});

bot.action("setProfile", (ctx) => {
  ctx.sendMessage("Por favor, envía el nombre de usuario de Twitter que deseas escuchar (sin @)");
  step = "twitterProfile";
});

bot.action("setGroup", (ctx) => {
  ctx.sendMessage(
    "Por favor, envía el ID del grupo de Telegram al que deseas enviar los tweets\n El id del grupo debe empezar con un -100");
  step = "telegramGroup";
});

bot.action("setMessage", (ctx) => {
  ctx.sendMessage("Por favor, envía el mensaje que quieres enviar junto con cada tweet");
  step = "message";
});

bot.action("showConfig", async (ctx) => {
  const chatId = ctx.chat.id;
  let config = await getConfiguration(chatId);
  ctx.sendMessage(
    `La configuracion actual es la siguiente:\nPerfil de Twitter -> ${config.twitterProfile}\nGrupo de Telegram -> ${config.telegramGroup}\nMensaje -> ${config.message}`
  );
});

bot.action("startBot", async (ctx) => {
  const chatId = ctx.chat.id;
  let config = await getConfiguration(chatId);

  if (config.twitterProfile && config.telegramGroup && config.message) {
    if (actualWorker.hasOwnProperty(config.chatId)) {
      const worker = actualWorker[config.chatId];
      worker.terminate()
    }
    startThread(config, ctx);
    config.thread = true
    ctx.reply(
     "El bot ha sido configurado correctamente y está escuchando los tweets del perfil de Twitter especificado."
    );
  } else {
    ctx.reply("No se puede iniciar el bot hasta que se establezcan todas las opciones de configuración.");
  }
  saveConfiguration(chatId, config);
});

bot.action("stopBot", async (ctx) => {
    const chatId = ctx.chat.id;
    let config = await getConfiguration(chatId);
    if (actualWorker.hasOwnProperty(config.chatId)) {
        const worker = actualWorker[config.chatId];
        worker.terminate()
        config.thread = null;
        saveConfiguration(chatId, config);
        ctx.reply(
            "El bot ha sido detenido"
           );
      } else if(config.thread){
        config.thread = null;
        saveConfiguration(chatId, config);
        ctx.reply(
            "Parece que el bot se cerró sin terminar la ejecución anterior"
           );
      }
      else {  
      ctx.reply("No hay ningun bot en ejecucion en estos momentos");
    }
  });

bot.launch();
