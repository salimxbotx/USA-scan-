const { Telegraf } = require('telegraf');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = "8024603369:AAGcKhruO6zey0ubFaRdGY740ZyYRYEyLDM";
const bot = new Telegraf(BOT_TOKEN);

// ✅ 2 মিনিট = 120000 মিলিসেকেন্ড
const DELETE_AFTER = 120000; 

// ✅ মেসেজ ডিলিট করার জন্য স্টোর করা
const messagesToDelete = new Map();

// ✅ OCR ফাংশন
function extractTextFromImage(imageUrl, outputPath) {
  return new Promise(async (resolve, reject) => {
    try {
      // ইমেজ ডাউনলোড
      const response = await axios({
        url: imageUrl,
        responseType: 'stream',
        timeout: 30000
      });
      
      const writer = fs.createWriteStream(outputPath);
      response.data.pipe(writer);
      
      writer.on('finish', () => {
        // Tesseract দিয়ে টেক্সট এক্সট্রাক্ট
        exec(`tesseract ${outputPath} stdout --psm 6`, (error, stdout, stderr) => {
          if (error) {
            console.error('OCR Error:', error.message);
            resolve('');
          } else {
            resolve(stdout);
          }
          // টেম্প ফাইল ডিলিট
          try {
            if (fs.existsSync(outputPath)) {
              fs.unlinkSync(outputPath);
            }
          } catch (e) {}
        });
      });
      
      writer.on('error', (err) => {
        console.error('Write Error:', err);
        resolve('');
      });
      
    } catch (error) {
      console.error('Download Error:', error.message);
      resolve('');
    }
  });
}

// ✅ ফোন নম্বর এক্সট্রাক্ট
function extractPhoneNumbers(text) {
  if (!text || text.trim().length === 0) return [];
  
  // শুধু নাম্বার এবং + চিহ্ন খুঁজে
  const regex = /\+?1?\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\+\d{10,15}/g;
  const matches = text.match(regex) || [];
  
  const cleaned = matches
    .map(num => {
      // শুধু ডিজিট এবং + রাখা
      let clean = num.replace(/[^\d+]/g, '');
      
      // যদি 10 ডিজিট হয় এবং +1 না থাকে
      if (clean.length === 10 && !clean.startsWith('+')) {
        return '+1' + clean;
      }
      // যদি 11 ডিজিট হয় এবং 1 দিয়ে শুরু হয়
      else if (clean.length === 11 && clean.startsWith('1')) {
        return '+' + clean;
      }
      // যদি 12 ডিজিট হয় এবং +1 দিয়ে শুরু হয়
      else if (clean.length === 12 && clean.startsWith('+1')) {
        return clean;
      }
      
      return clean.startsWith('+') ? clean : '+' + clean;
    })
    .filter(num => {
      const digits = num.replace('+', '').replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15;
    })
    .filter((num, index, self) => self.indexOf(num) === index);
  
  return cleaned;
}

// ✅ মেসেজ ডিলিট করার ফাংশন
async function scheduleDelete(ctx, chatId, messageId) {
  console.log(`⏰ Scheduled delete for message ${messageId} in ${DELETE_AFTER/1000} seconds`);
  
  setTimeout(async () => {
    try {
      await ctx.telegram.deleteMessage(chatId, messageId);
      console.log(`✅ Deleted message ${messageId}`);
    } catch (error) {
      console.log(`⚠️ Could not delete ${messageId}: ${error.message}`);
    }
  }, DELETE_AFTER);
}

// ✅ ইমেজ হ্যান্ডলার
bot.on('photo', async (ctx) => {
  const chatId = ctx.message.chat.id;
  const messageId = ctx.message.message_id;
  
  try {
    // প্রোসেসিং মেসেজ পাঠানো
    const processingMsg = await ctx.reply('🔄 Scanning image... Please wait.');
    
    // প্রোসেসিং মেসেজকেও ডিলিট করার জন্য শিডিউল
    scheduleDelete(ctx, chatId, processingMsg.message_id);
    
    // ছবি প্রসেস করা
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    
    // টেম্প ফাইল পাথ
    const tempFile = path.join('/tmp', `image_${Date.now()}.jpg`);
    
    // OCR প্রসেস
    const text = await extractTextFromImage(imageUrl, tempFile);
    console.log('Extracted text:', text.substring(0, 100));
    
    if (!text || text.trim().length < 5) {
      const errorMsg = await ctx.reply('❌ Could not read text from image.\nPlease send a clearer image with visible numbers.');
      scheduleDelete(ctx, chatId, errorMsg.message_id);
      return;
    }
    
    const numbers = extractPhoneNumbers(text);
    console.log('Found numbers:', numbers);
    
    if (numbers.length === 0) {
      const noNumMsg = await ctx.reply('📱 No phone numbers found in the image.');
      scheduleDelete(ctx, chatId, noNumMsg.message_id);
      return;
    }
    
    // ফলাফল মেসেজ তৈরি
    const numbersText = numbers.map((num, i) => `${i+1}. ${num}`).join('\n');
    const totalNumbers = numbers.length;
    
    const resultMsg = await ctx.reply(
      `✅ Found ${totalNumbers} phone number(s):\n\n${numbersText}\n\n` +
      `⏰ This message will auto-delete in 2 minutes.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{
              text: '📋 Copy All Numbers',
              callback_data: 'copy_numbers'
            }]
          ]
        }
      }
    );
    
    // ফলাফল মেসেজ ডিলিট শিডিউল
    scheduleDelete(ctx, chatId, resultMsg.message_id);
    
    // ইউজারের মূল মেসেজও ডিলিট শিডিউল (ঐচ্ছিক)
    scheduleDelete(ctx, chatId, messageId);
    
  } catch (error) {
    console.error('Main Error:', error);
    const errorMsg = await ctx.reply('❌ Error processing image. Please try again.');
    scheduleDelete(ctx, chatId, errorMsg.message_id);
  }
});

// ✅ কপি বাটন হ্যান্ডলার
bot.action('copy_numbers', async (ctx) => {
  try {
    // মেসেজ থেকে নম্বর এক্সট্রাক্ট
    const messageText = ctx.callbackQuery.message.text;
    const numbers = messageText.match(/\+?1?\d{10,15}/g) || [];
    
    if (numbers.length > 0) {
      const numbersToCopy = numbers.join('\n');
      
      await ctx.answerCbQuery('✅ Numbers ready to copy!');
      
      const copyMsg = await ctx.reply(
        `📋 Copy these numbers:\n\n\`${numbersToCopy}\`\n\n` +
        `Tap and hold to select all, then copy.`,
        { parse_mode: 'Markdown' }
      );
      
      // কপি মেসেজও ডিলিট হবে 2 মিনিট পর
      scheduleDelete(ctx, ctx.callbackQuery.message.chat.id, copyMsg.message_id);
      
    } else {
      await ctx.answerCbQuery('❌ No numbers found');
    }
    
  } catch (error) {
    console.error('Copy Error:', error);
    await ctx.answerCbQuery('❌ Error');
  }
});

// ✅ স্টার্ট কম্যান্ড
bot.command('start', async (ctx) => {
  const startMsg = await ctx.reply(
    '👋 *Phone Number Scanner Bot*\n\n' +
    '📸 Send me an image with phone numbers\n' +
    '✅ I will extract all US/international numbers\n' +
    '📋 Click button to copy all numbers\n' +
    '⏰ Messages auto-delete after 2 minutes\n\n' +
    'Just send an image and I will scan it automatically!',
    { parse_mode: 'Markdown' }
  );
  
  // স্টার্ট মেসেজও ডিলিট হবে
  scheduleDelete(ctx, ctx.chat.id, startMsg.message_id);
});

// ✅ হেল্প কম্যান্ড
bot.command('help', async (ctx) => {
  const helpMsg = await ctx.reply(
    '🆘 *How to use:*\n\n' +
    '1. 📸 Send any image with phone numbers\n' +
    '2. 🔄 Bot will automatically scan it\n' +
    '3. ✅ All numbers will be extracted\n' +
    '4. 📋 Click "Copy All Numbers" button\n' +
    '5. ⏰ All messages delete after 2 minutes\n\n' +
    'For best results, send clear images with visible text.',
    { parse_mode: 'Markdown' }
  );
  
  scheduleDelete(ctx, ctx.chat.id, helpMsg.message_id);
});

// ✅ বট চালু
bot.launch()
  .then(() => {
    console.log('✅ Bot started successfully!');
    console.log(`⏰ Auto-delete time: ${DELETE_AFTER/1000} seconds`);
    console.log('📸 Ready to scan images...');
  })
  .catch(err => {
    console.error('❌ Failed to start bot:', err);
  });

// ✅ গ্রেসফুল শাটডাউন
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
