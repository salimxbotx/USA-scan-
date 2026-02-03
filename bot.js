const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = "8024603369:AAGcKhruO6zey0ubFaRdGY740ZyYRYEyLDM";
const bot = new Telegraf(BOT_TOKEN);

// ডিরেক্ট OCR এর জন্য exec ব্যবহার
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function extractTextFromImage(imageUrl) {
    try {
        console.log("Downloading image...");
        
        // ইমেজ ডাউনলোড
        const response = await axios({
            method: 'GET',
            url: imageUrl,
            responseType: 'arraybuffer'
        });
        
        // টেম্প ফাইল সেভ
        const tempDir = '/tmp';
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempImagePath = path.join(tempDir, `ocr_image_${Date.now()}.png`);
        fs.writeFileSync(tempImagePath, Buffer.from(response.data));
        
        console.log("Running OCR...");
        
        // সরাসরি tesseract কমান্ড
        const { stdout } = await execPromise(`tesseract "${tempImagePath}" stdout --psm 6`);
        
        // টেম্প ফাইল ডিলিট
        fs.unlinkSync(tempImagePath);
        
        console.log("OCR completed");
        return stdout;
        
    } catch (error) {
        console.error("OCR Error:", error.message);
        return null;
    }
}

function extractNumbers(text) {
    if (!text) return [];
    
    // শুধু US ফোন নম্বর প্যাটার্ন
    const phoneRegex = /(\+?1?[\.\-\s]?\(?\d{3}\)?[\.\-\s]?\d{3}[\.\-\s]?\d{4})/g;
    const matches = text.match(phoneRegex) || [];
    
    const numbers = [];
    for (let match of matches) {
        // শুধু ডিজিট
        let digits = match.replace(/\D/g, '');
        
        // ফরম্যাটিং
        if (digits.length === 10) {
            numbers.push('+1' + digits);
        } else if (digits.length === 11 && digits.startsWith('1')) {
            numbers.push('+' + digits);
        } else if (digits.length >= 10 && digits.length <= 15) {
            numbers.push('+' + digits);
        }
    }
    
    // ডুপ্লিকেট রিমুভ
    return [...new Set(numbers)];
}

// ২ মিনিট পর ডিলিট
function scheduleDelete(ctx, chatId, messageId) {
    setTimeout(async () => {
        try {
            await bot.telegram.deleteMessage(chatId, messageId);
            console.log(`Deleted message ${messageId}`);
        } catch (e) {
            // ইগনোর
        }
    }, 2 * 60 * 1000); // ২ মিনিট
}

// ইমেজ হ্যান্ডলার
bot.on('photo', async (ctx) => {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;
    
    try {
        console.log("Processing image...");
        
        // ইমেজ ফাইল পেতে
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.telegram.getFile(photo.file_id);
        const imageUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        
        // OCR প্রসেস
        const text = await extractTextFromImage(imageUrl);
        
        if (!text) {
            const errorMsg = await ctx.reply("❌");
            scheduleDelete(ctx, chatId, errorMsg.message_id);
            scheduleDelete(ctx, chatId, messageId);
            return;
        }
        
        // নাম্বার এক্সট্রাক্ট
        const numbers = extractNumbers(text);
        
        if (numbers.length === 0) {
            const noNumMsg = await ctx.reply("❌");
            scheduleDelete(ctx, chatId, noNumMsg.message_id);
            scheduleDelete(ctx, chatId, messageId);
            return;
        }
        
        // শুধু নাম্বার দেখাবে - কোনো ফালতু টেক্সট নেই
        const result = await ctx.reply(numbers.join('\n'));
        
        // সব ডিলিট হবে ২ মিনিট পর
        scheduleDelete(ctx, chatId, result.message_id);
        scheduleDelete(ctx, chatId, messageId);
        
        console.log(`Found ${numbers.length} numbers`);
        
    } catch (error) {
        console.error("Error:", error.message);
        const errorMsg = await ctx.reply("❌");
        scheduleDelete(ctx, chatId, errorMsg.message_id);
        scheduleDelete(ctx, chatId, messageId);
    }
});

// স্টার্ট কম্যান্ড (ডিলিট হবে)
bot.command('start', async (ctx) => {
    const msg = await ctx.reply('📸');
    scheduleDelete(ctx, ctx.chat.id, msg.message_id);
});

// বট শুরু
bot.launch()
    .then(() => {
        console.log('✅ Bot started successfully!');
        console.log('🤖 Ready to scan images...');
    })
    .catch(err => {
        console.error('❌ Failed to start:', err.message);
    });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
