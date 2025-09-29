// =================================================================
// 1. SETUP & IMPORTS
// =================================================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const Owner = require('./models/owner.model');
const ManagedChannel = require('./models/managedChannel.model');
const Subscriber = require('./models/subscriber.model');
const Transaction = require('./models/transaction.model');
const PendingPayment = require('./models/pendingPayment.model');
const { handleOwnerMessage, handleOwnerCallback } = require('./bot/ownerFlow');
const { handleSubscriberMessage, handleSubscriberCallback, initialize } = require('./bot/subscriberFlow');

// =================================================================
// 2. CONFIGURATION & INITIALIZATION
// =================================================================
const { PORT, MONGO_URI, BOT_TOKEN, SUPER_ADMIN_ID, AUTOMATION_SECRET, PLATFORM_COMMISSION_PERCENT } = process.env;

if (!MONGO_URI || !BOT_TOKEN || !SUPER_ADMIN_ID) {
    console.error("FATAL ERROR: Missing required environment variables.");
    process.exit(1);
}

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());
app.use(express.text());
app.use(express.static('public'));

initialize(bot);

// =================================================================
// 3. DATABASE CONNECTION
// =================================================================
mongoose.connect(MONGO_URI).then(() => console.log('✅ MongoDB Connected!')).catch(err => {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
});

// =================================================================
// 4. API ROUTES
// =================================================================
app.post('/api/shortcut', async (req, res) => {
    if (req.headers['x-shortcut-secret'] !== AUTOMATION_SECRET) return res.status(403).send('Unauthorized');
    const smsText = req.body;
    if (!smsText) return res.status(400).send('Bad Request');
    
    await bot.sendMessage(SUPER_ADMIN_ID, `🤖 Automated SMS Received:\n---\n${smsText}\n---`);
    
    const amountRegex = /(?:Rs\.?|₹|INR)\s*([\d,]+\.\d{2})/;
    const match = smsText.match(amountRegex);
    if (match && match[1]) {
        const amount = match[1].replace(/,/g, '');
        await processPayment(amount, bot, "Automatic (SMS)");
    }
    
    res.status(200).send('OK');
});

const superAdminApi = require('./api/superAdmin');
app.use('/api/super', superAdminApi(bot));

// =================================================================
// 5. PAYMENT PROCESSING LOGIC
// =================================================================
async function processPayment(amount, bot, method = "Unknown") {
    try {
        const payment = await PendingPayment.findOneAndDelete({ unique_amount: amount });
        if (!payment) {
            if (method.startsWith("Manual")) {
                await bot.sendMessage(SUPER_ADMIN_ID, `❌ **Verification Failed**\nNo pending payment found for amount \`₹${amount}\`.`, {parse_mode: 'Markdown'});
            }
            return;
        }
        
        const { subscriber_id, owner_id, channel_id, plan_days, plan_price, channel_id_mongoose } = payment;
        const channel = await ManagedChannel.findById(channel_id_mongoose);
        if (!channel) throw new Error(`Channel not found with mongoose ID: ${channel_id_mongoose}`);
        
        const owner = await Owner.findById(owner_id);
        if (!owner) throw new Error(`Owner not found with ID: ${owner_id}`);

        const commission = (plan_price * PLATFORM_COMMISSION_PERCENT) / 100;
        const amountToCredit = plan_price - commission;

        await Transaction.create({ owner_id, subscriber_id, channel_id, plan_days, amount_paid: plan_price, commission_charged: commission, amount_credited_to_owner: amountToCredit });
        await Owner.findByIdAndUpdate(owner_id, { $inc: { wallet_balance: amountToCredit, total_earnings: plan_price } });

        const expiryDate = new Date(Date.now() + plan_days * 24 * 60 * 60 * 1000);
        await Subscriber.findOneAndUpdate({ telegram_id: subscriber_id, channel_id: channel_id }, { expires_at: expiryDate, owner_id: owner.telegram_id, subscribed_at: new Date() }, { upsert: true });
        
        const inviteLink = await bot.createChatInviteLink(channel_id, { member_limit: 1 });
        
        await bot.sendMessage(subscriber_id, `✅ Payment confirmed! Your access to "${channel.channel_name}" is active.\n\nJoin using this one-time link: ${inviteLink.invite_link}`);
        await bot.sendMessage(owner.telegram_id, `🎉 New Sale!\nA user subscribed to your channel "${channel.channel_name}" for ${plan_days} days.\n💰 ₹${amountToCredit.toFixed(2)} has been credited to your wallet.`);
        await bot.sendMessage(SUPER_ADMIN_ID, `💸 **Sale Confirmed!** (via ${method})\n\nOwner: ${owner.first_name}\nAmount: \`₹${plan_price.toFixed(2)}\`\nCommission: \`₹${commission.toFixed(2)}\`\nSubscriber: \`${subscriber_id}\``, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error("[processPayment] FATAL CRASH:", error);
        await bot.sendMessage(SUPER_ADMIN_ID, `❌ **CRITICAL ERROR during payment processing for ₹${amount}**\n\n\`${error.message}\`\n\nPlease check the logs.`);
    }
}

// =================================================================
// 6. TELEGRAM BOT ROUTER (THE FIX IS HERE)
// =================================================================

async function handleSuperAdminCommands(bot, msg) {
    const text = msg.text || "";
    const amountMatch = text.match(/(\d+\.\d{2})/);
    if (amountMatch && amountMatch[1]) {
        const amount = amountMatch[1];
        await bot.sendMessage(msg.from.id, `Received amount ₹${amount}. Attempting manual verification...`);
        await processPayment(amount, bot, "Manual (Admin)");
        return true;
    }
    // Add other super admin commands here if needed
    return false;
}

bot.on('message', async (msg) => {
    const fromId = msg.from.id.toString();
    const text = msg.text || "";

    // Specific command for subscribers first
    if (text.startsWith('/start ')) {
        return handleSubscriberMessage(bot, msg);
    }

    // Check if the user is the Super Admin
    if (fromId === SUPER_ADMIN_ID) {
        const commandHandled = await handleSuperAdminCommands(bot, msg);
        // If it was a special admin command (like sending an amount), stop.
        // Otherwise, treat the admin as a normal owner.
        if (commandHandled) {
            return;
        }
    }

    // Check if the user is a registered owner (this includes the admin now)
    const owner = await Owner.findOne({ telegram_id: fromId });
    if (owner) {
        return handleOwnerMessage(bot, msg);
    }
    
    // If none of the above, it's a new user
    return handleSubscriberMessage(bot, msg);
});


bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data || "";
    if (data.startsWith('sub_')) {
        await handleSubscriberCallback(bot, callbackQuery);
    } else if (data.startsWith('owner_')) {
         await handleOwnerCallback(bot, callbackQuery);
    }
});

bot.on("polling_error", (error) => {
    console.log(`Polling Error: ${error.code} - ${error.message}`);
});
console.log('🤖 Bot is running...');

// =================================================================
// 7. START THE SERVER
// =================================================================
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
