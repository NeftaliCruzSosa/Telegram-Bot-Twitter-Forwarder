const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const usersSchema = new Schema(
  {
    chatId: {type: String, trim: true},
    twitterProfile: { type: String, trim: true },
    telegramGroup: { type: String, trim: true },
    message: { type: String, trim: true },
    thread: { type: String, trim: true },
  }
);

const User = mongoose.model("users", usersSchema);

module.exports = User;
