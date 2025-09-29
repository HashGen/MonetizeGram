// =================================================================
// 1. SETUP & IMPORTS
// =================================================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// --- Database Models ---
const Owner = require('./models/owner.model');
const ManagedChannel = require('./models/managedChannel.model');
const Subscriber = require('./models/subscriber.model');
const Transaction = require('./models/transaction.model');

// =================================================================
// 2. CONFIGURATION & INITIALIZATION
// =================================================================

const { PORT, MONGO_URI, BOT_TOKEN, AUTOMATION_SECRET, SUPER_ADMIN_ID } = process.env;

if (!MONGO_URI || !BOT_TOKEN || !SUPER_ADMIN_ID) {
    console.error("FATAL ERROR: MONGO_URI, BOT_TOKEN, and SUPER_ADMIN_ID are required in .env file.");
    process.exit(1);
}

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

app.use(express.json());
app.use(express.text());
app.use(express.static('public'));

// =================================================================
// 3. DATABASE CONNECTION
// =================================================================
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Successfully connected to MongoDB!'))
    .catch(err => {
        console.error('❌ Error connecting to MongoDB:', err);
        process.exit(1);
    });

// =================================================================
// 4. API ROUTES
// =================================================================
app.post('/api/shortcut', async (req, res) => {
    const providedSecret = req.headers['x-shortcut-secret'];
    if (providedSecret !== AUTOMATION_SECRET) {
        return res.status(403).send('Unauthorized: Invalid secret.');
    }

    const smsText = req.body;
    if (!smsText) {
        return res.status(400).send('Bad Request: SMS text is missing.');
    }
    
    console.log(`Received payment SMS: "${smsText.substring(0, 50)}..."`);
    await bot.sendMessage(SUPER_ADMIN_ID, `🤖 Automated SMS Received:\n\n---\n${smsText}\n---`);

    // Yahan hum payment process karne wala function call karenge (jo hum aage banayenge)
    // await processPaymentFromSms(smsText, bot);

    res.status(200).send('OK');
});

// =================================================================
// 5. TELEGRAM BOT LOGIC
// =================================================================
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        bot.sendMessage(chatId, 'Welcome to the SubTool SaaS Platform! (Foundation Ready)');
    }
    // Baaki saare commands yahan aayenge
});

console.log('Bot is polling for messages...');

// =================================================================
// 6. START THE SERVER
// =================================================================
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
