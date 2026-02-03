const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');

const BOT_TOKEN = "8024603369:AAGcKhruO6zey0ubFaRdGY740ZyYRYEyLDM";
const bot = new Telegraf(BOT_TOKEN);

// OCR ছাড়াই নাম্বার এক্সট্রাক্ট (ইমেজ থেকে টেক্সট না পড়ে)
function extractNumbersFromText(text) {
  if (!text) return [];
  
  // US ফোন নম্বর প্যাটার্ন
  const patterns = [
    /\+\d{10,15}/g, // +12345678901
    /\b\d{10,15}\b/g, // 1234567890
    /\b1?\d{10}\b/g // 1234567890 বা 11234567890
  ];
  
  let allNumbers = [];
  
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    allNumbers = [...allNumbers, ...matches];
  }
  
  // ক্লিনিং এবং ফরম্যাটিং
  const cleaned = [...new Set(allNumbers.map(num => {
    // শুধু ডিজিট রাখা
    const digits = num.replace(/\D/g, '');
    
    // যদি 10 ডিজিট হয়
    if (digits.length === 10) {
      return '+1' + digits;
    }
    // যদি 11 ডিজিট হয় এবং 1 দিয়ে শুরু হয়
    else if (digits.length === 11 && digits.startsWith('1')) {
      return '+' + digits;
    }
    // অন্য ক্ষেত্রে
    else {
      return '+' + digits;
    }
  }).filter(num => {
    const digitCount = num.replace('+', '').length;
    return digitCount >= 10 && digitCount <= 15;
  }))];
  
  return cleaned;
}

// টেক্সটে শুধু নাম্বার থাকলে format করবে
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  
  // শুধু ফোন নম্বর থাকলে
  const numbers = extractNumbersFromText(text);
  
  if (numbers.length > 0) {
    // ফর্ম্যাটেড আউটপুট (টাচ করলেই কপি হবে)
    const output = numbers.join('\n');
    
    const msg = await ctx.reply(output);
    
    // 2 মিনিট পর ডিলিট
    setTimeout(async () => {
      try {
        await ctx.deleteMessage(msg.message_id);
        await ctx.deleteMessage(ctx.message.message_id);
      } catch(e) {}
    }, 120000);
  }
});

// ইমেজ আসলে শুধু বলে দিবে টেক্সট পাঠাতে
bot.on('photo', async (ctx) => {
  const msg = await ctx.reply(
    '📸 Please send the phone numbers as text (type or paste them).\n\n' +
    'Example:\n' +
    '+16022078028\n' +
    '+16024971069\n' +
    '+16024973298'
  );
  
  // 2 মিনিট পর ডিলিট
  setTimeout(async () => {
    try {
      await ctx.deleteMessage(msg.message_id);
      await ctx.deleteMessage(ctx.message.message_id);
    } catch(e) {}
  }, 120000);
});

// স্টার্ট কম্যান্ড
bot.command('start', async (ctx) => {
  const msg = await ctx.reply(
    '📞 Phone Number Formatter Bot\n\n' +
    'Just send phone numbers (one per line):\n\n' +
    '+16022078028\n' +
    '+16024971069\n' +
    '+16024973298\n\n' +
    'I will format them properly and you can copy by tapping.'
  );
  
  setTimeout(async () => {
    try {
      await ctx.deleteMessage(msg.message_id);
    } catch(e) {}
  }, 120000);
});

// এরর হ্যান্ডলিং
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

// বট শুরু
bot.launch()
  .then(() => {
    console.log('✅ Bot started successfully!');
  })
  .catch(err => {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  });
