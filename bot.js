const { Telegraf } = require('telegraf');
const Tesseract = require('node-tesseract-ocr');
const axios = require('axios');
const sharp = require('sharp');

// Bot টোকেন
const BOT_TOKEN = "8024603369:AAGcKhruO6zey0ubFaRdGY740ZyYRYEyLDM";
const bot = new Telegraf(BOT_TOKEN);

// ফোন নম্বর ডিটেক্ট করার রেগুলার এক্সপ্রেশন
const PHONE_REGEX = /(\+\d{10,15})|(\b\d{10,15}\b)/g;

// OCR কনফিগারেশন
const tesseractConfig = {
  lang: 'eng',
  oem: 1,
  psm: 6
};

// ইমেজ থেকে টেক্সট এক্সট্রাক্ট
async function extractTextFromImage(imageUrl) {
  try {
    const response = await axios({
      url: imageUrl,
      responseType: 'arraybuffer',
      timeout: 30000
    });
    
    const imageBuffer = Buffer.from(response.data, 'binary');
    
    const processedImage = await sharp(imageBuffer)
      .grayscale()
      .normalize()
      .toBuffer();
    
    const text = await Tesseract.recognize(processedImage, tesseractConfig);
    return text;
  } catch (error) {
    console.error('Error extracting text:', error.message);
    return null;
  }
}

// টেক্সট থেকে ফোন নম্বর এক্সট্রাক্ট
function extractPhoneNumbers(text) {
  if (!text) return [];
  
  const allMatches = text.match(PHONE_REGEX) || [];
  
  const cleanedNumbers = allMatches
    .map(num => {
      let cleanNum = num.replace(/[^\d\+]/g, '');
      
      if (cleanNum.length >= 10 && !cleanNum.startsWith('+')) {
        cleanNum = '+1' + cleanNum;
      }
      
      if (cleanNum.startsWith('+1') && cleanNum.length === 12) {
        return cleanNum;
      } else if (cleanNum.startsWith('1') && cleanNum.length === 11) {
        return '+' + cleanNum;
      } else if (cleanNum.length === 10) {
        return '+1' + cleanNum;
      }
      
      return cleanNum;
    })
    .filter(num => {
      const numWithoutPlus = num.replace('+', '');
      return numWithoutPlus.length >= 10 && numWithoutPlus.length <= 12;
    })
    .filter((num, index, self) => self.indexOf(num) === index)
    .sort();
  
  return cleanedNumbers;
}

// ২ মিনিট পর মেসেজ ডিলিট
function deleteOldMessages(ctx, chatId, messageId) {
  setTimeout(async () => {
    try {
      await ctx.telegram.deleteMessage(chatId, messageId);
    } catch (error) {}
  }, 2 * 60 * 1000);
}

// ইমেজ হ্যান্ডলার
bot.on('photo', async (ctx) => {
  try {
    const processingMsg = await ctx.reply('🔄 Scanning image...');
    
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);
    const imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    
    const extractedText = await extractTextFromImage(imageUrl);
    
    if (!extractedText) {
      await ctx.telegram.editMessageText(
        processingMsg.chat.id,
        processingMsg.message_id,
        null,
        '❌ Could not scan image.'
      );
      deleteOldMessages(ctx, processingMsg.chat.id, processingMsg.message_id);
      return;
    }
    
    const phoneNumbers = extractPhoneNumbers(extractedText);
    
    if (phoneNumbers.length === 0) {
      await ctx.telegram.editMessageText(
        processingMsg.chat.id,
        processingMsg.message_id,
        null,
        '📱 No phone numbers found.'
      );
      deleteOldMessages(ctx, processingMsg.chat.id, processingMsg.message_id);
      return;
    }
    
    const numbersText = phoneNumbers.map(num => `📞 ${num}`).join('\n');
    const allNumbers = phoneNumbers.join('\n');
    
    await ctx.telegram.editMessageText(
      processingMsg.chat.id,
      processingMsg.message_id,
      null,
      `✅ Found ${phoneNumbers.length} number(s):\n\n${numbersText}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{
              text: '📋 Copy All Numbers',
              callback_data: `copy_${Buffer.from(allNumbers).toString('base64')}`
            }]
          ]
        }
      }
    );
    
    deleteOldMessages(ctx, processingMsg.chat.id, processingMsg.message_id);
    
  } catch (error) {
    console.error('Error:', error);
    await ctx.reply('❌ Error processing image.');
  }
});

// কপি বাটন হ্যান্ডলার
bot.action(/^copy_/, async (ctx) => {
  try {
    const base64Data = ctx.callbackQuery.data.replace('copy_', '');
    const numbersText = Buffer.from(base64Data, 'base64').toString();
    
    await ctx.answerCbQuery('✅ Numbers copied!');
    
    await ctx.reply(`📋 Copy below:\n\n\`${numbersText}\``, {
      parse_mode: 'Markdown'
    });
    
  } catch (error) {
    await ctx.answerCbQuery('❌ Error');
  }
});

// স্টার্ট কম্যান্ড
bot.command('start', async (ctx) => {
  await ctx.reply(
    '👋 Send me an image with phone numbers.\nI will scan and extract them.'
  );
});

// বট শুরু
async function startBot() {
  try {
    await bot.launch();
    console.log('✅ Bot is running!');
  } catch (error) {
    console.error('Failed to start bot:', error);
  }
}

startBot();
