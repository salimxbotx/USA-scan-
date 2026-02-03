const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Bot টোকেন এখানে ব্যবহার করুন
const TOKEN = '8024603369:AAGBJXLVIs7lwOntKfl4hG3WAeNvpYmyVeI';
const bot = new TelegramBot(TOKEN, { polling: true });

// OCR.space API কী (ফ্রি টিয়ার, দিনে 500 রিকুয়েস্ট)
const OCR_API_KEY = 'K85657543388957';
const OCR_API_URL = 'https://api.ocr.space/parse/image';

// মেসেজ ডিলিট করার জন্য ম্যাপ
const messagesToDelete = new Map();

// USA ফোন নাম্বার ডিটেক্ট করার regex প্যাটার্ন
const US_PHONE_REGEX = /\b(\+1\s?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/g;
const INTERNATIONAL_PHONE_REGEX = /\b(\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,9}\b/g;

// ইমেজ ডাউনলোড ফাংশন
async function downloadImage(fileId, chatId) {
    try {
        const fileLink = await bot.getFileLink(fileId);
        const response = await axios({
            url: fileLink,
            responseType: 'stream'
        });
        
        const filePath = path.join(__dirname, `temp_image_${chatId}_${Date.now()}.jpg`);
        const writer = fs.createWriteStream(filePath);
        
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(filePath));
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('Error downloading image:', error);
        return null;
    }
}

// OCR ব্যবহার করে ইমেজ থেকে টেক্সট extract
async function extractTextFromImage(imagePath) {
    try {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(imagePath));
        formData.append('apikey', OCR_API_KEY);
        formData.append('language', 'eng');
        formData.append('isOverlayRequired', 'false');
        formData.append('OCREngine', '2');

        const response = await axios.post(OCR_API_URL, formData, {
            headers: formData.getHeaders()
        });

        if (response.data.IsErroredOnProcessing) {
            console.error('OCR Error:', response.data.ErrorMessage);
            return null;
        }

        return response.data.ParsedResults?.[0]?.ParsedText || '';
    } catch (error) {
        console.error('OCR Processing Error:', error);
        return null;
    }
}

// টেক্সট থেকে ফোন নাম্বারগুলো আলাদা করুন
function extractPhoneNumbers(text) {
    if (!text) return [];
    
    const allNumbers = [];
    
    // USA ফোন নাম্বার খুঁজুন
    const usNumbers = text.match(US_PHONE_REGEX) || [];
    
    // আন্তর্জাতিক ফোন নাম্বার খুঁজুন (USA ছাড়া)
    const intlNumbers = text.match(INTERNATIONAL_PHONE_REGEX) || [];
    
    // সব নাম্বার একত্রিত করুন এবং ডুপ্লিকেট মুছুন
    const combined = [...usNumbers, ...intlNumbers];
    const uniqueNumbers = [...new Set(combined)];
    
    return uniqueNumbers.filter(num => {
        // শুধুমাত্র ডিজিট এবং + চিহ্ন থাকা নাম্বার গ্রহণ করুন
        const digitCount = (num.match(/\d/g) || []).length;
        return digitCount >= 7; // সর্বনিম্ন ৭ ডিজিটের নাম্বার গ্রহণ করুন
    });
}

// ২ মিনিট পর মেসেজ ডিলিট করার ফাংশন
function scheduleMessageDeletion(chatId, messageId) {
    const timeoutId = setTimeout(() => {
        bot.deleteMessage(chatId, messageId).catch(err => {
            console.error('Error deleting message:', err.message);
        });
        messagesToDelete.delete(`${chatId}_${messageId}`);
    }, 2 * 60 * 1000); // 2 মিনিট = 120,000 মিলিসেকেন্ড
    
    messagesToDelete.set(`${chatId}_${messageId}`, timeoutId);
}

// বট শুরু হলে
console.log('Bot is running...');

// যখন ইমেজ পাঠানো হয়
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    
    try {
        // "Processing..." মেসেজ পাঠান
        const processingMsg = await bot.sendMessage(chatId, '🔄 Processing image...');
        
        // সবচেয়ে বড় রেজোলিউশনের ইমেজ নিন
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        
        // ইমেজ ডাউনলোড করুন
        const imagePath = await downloadImage(fileId, chatId);
        
        if (!imagePath) {
            await bot.editMessageText('❌ Failed to download image.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            scheduleMessageDeletion(chatId, processingMsg.message_id);
            return;
        }
        
        // ইমেজ থেকে টেক্সট extract করুন
        const extractedText = await extractTextFromImage(imagePath);
        
        // টেম্প ফাইল ডিলিট করুন
        fs.unlinkSync(imagePath);
        
        if (!extractedText) {
            await bot.editMessageText('❌ Could not extract text from image.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            scheduleMessageDeletion(chatId, processingMsg.message_id);
            return;
        }
        
        // ফোন নাম্বারগুলো extract করুন
        const phoneNumbers = extractPhoneNumbers(extractedText);
        
        if (phoneNumbers.length === 0) {
            await bot.editMessageText('📱 No phone numbers found in the image.', {
                chat_id: chatId,
                message_id: processingMsg.message_id
            });
            scheduleMessageDeletion(chatId, processingMsg.message_id);
            return;
        }
        
        // মনোস্পেস ফরম্যাটে নাম্বারগুলো দেখান
        const numbersText = phoneNumbers.map(num => `\`${num}\``).join('\n');
        
        // মূল প্রসেসিং মেসেজ আপডেট করুন
        await bot.editMessageText(numbersText, {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // এই মেসেজকেও ২ মিনিট পর ডিলিট করার জন্য শিডিউল করুন
        scheduleMessageDeletion(chatId, processingMsg.message_id);
        
    } catch (error) {
        console.error('Error processing image:', error);
        bot.sendMessage(chatId, '❌ An error occurred while processing the image.')
            .then(msg => scheduleMessageDeletion(chatId, msg.message_id));
    }
});

// টেক্সট মেসেজের জন্যও ডিলিট শিডিউল করুন
bot.on('text', (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        scheduleMessageDeletion(msg.chat.id, msg.message_id);
    }
});

// বট বন্ধ করার সময় সব টাইমআউট ক্লিয়ার করুন
process.on('SIGINT', () => {
    messagesToDelete.forEach((timeoutId) => {
        clearTimeout(timeoutId);
    });
    process.exit();
});

// Render.com-এর জন্য পোর্ট সেটআপ
const PORT = process.env.PORT || 3000;
const http = require('http');
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Telegram Bot is running\n');
});
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
