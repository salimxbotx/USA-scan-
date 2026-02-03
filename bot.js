const { Telegraf } = require('telegraf');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');

const BOT_TOKEN = "8024603369:AAGcKhruO6zey0ubFaRdGY740ZyYRYEyLDM";
const bot = new Telegraf(BOT_TOKEN);

// OCR স্ক্যান
async function scanImage(url) {
  const temp = `/tmp/${Date.now()}.jpg`;
  try {
    const res = await axios({ url, responseType: 'stream' });
    const writer = fs.createWriteStream(temp);
    res.data.pipe(writer);
    
    return new Promise((resolve) => {
      writer.on('finish', () => {
        exec(`tesseract ${temp} stdout --psm 6`, (err, stdout) => {
          try { fs.unlinkSync(temp); } catch(e) {}
          resolve(stdout || '');
        });
      });
      writer.on('error', () => resolve(''));
    });
  } catch(e) { return ''; }
}

// নাম্বার বের করা
function getNumbers(text) {
  if (!text) return [];
  const matches = text.match(/\+?1?\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [];
  return [...new Set(matches.map(n => {
    const clean = n.replace(/\D/g, '');
    if (clean.length === 10) return '+1' + clean;
    if (clean.length === 11 && clean[0] === '1') return '+' + clean;
    return clean.startsWith('+') ? clean : '+' + clean;
  }).filter(n => n.replace('+', '').length >= 10))];
}

// ২ মিনিট পর ডিলিট
const deleteAfter = (ctx, chatId, msgId) => {
  setTimeout(() => {
    try { ctx.telegram.deleteMessage(chatId, msgId); } catch(e) {}
  }, 120000);
};

// ইমেজ হ্যান্ডলার
bot.on('photo', async (ctx) => {
  const chat = ctx.message.chat.id;
  const msg = ctx.message.message_id;
  
  const processing = await ctx.reply('🔄');
  deleteAfter(ctx, chat, processing.message_id);
  
  try {
    const photo = ctx.message.photo.slice(-1)[0];
    const file = await ctx.telegram.getFile(photo.file_id);
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    
    const text = await scanImage(url);
    const numbers = getNumbers(text);
    
    if (!numbers.length) {
      const err = await ctx.reply('❌');
      deleteAfter(ctx, chat, err.message_id);
      return;
    }
    
    const result = await ctx.reply(numbers.join('\n'), {
      reply_markup: { inline_keyboard: [[{ text: '📋 Copy', callback_data: 'copy' }]] }
    });
    
    // নাম্বার স্টোর
    global.numbersData = global.numbersData || {};
    global.numbersData[result.message_id] = numbers.join('\n');
    
    deleteAfter(ctx, chat, msg);
    deleteAfter(ctx, chat, result.message_id);
    
  } catch(e) {
    const err = await ctx.reply('❌');
    deleteAfter(ctx, chat, err.message_id);
  }
});

// কপি বাটন - শুধু কপি হবে
bot.action('copy', async (ctx) => {
  const msgId = ctx.callbackQuery.message.message_id;
  const numbers = global.numbersData ? global.numbersData[msgId] : null;
  
  if (numbers) {
    await ctx.answerCbQuery('✅ Copied!');
    delete global.numbersData[msgId];
  } else {
    await ctx.answerCbQuery('❌');
  }
});

// স্টার্ট
bot.command('start', async (ctx) => {
  const msg = await ctx.reply('📸 Send image');
  deleteAfter(ctx, ctx.chat.id, msg.message_id);
});

// রান
bot.launch().then(() => console.log('✅ Bot running'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
