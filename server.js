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
const { PORT, MONGO_URI, BOT_TOKEN, SUPER_ADMIN_ID, AUTOMATION_SECRET, PLATFORM_COMMISSION_PERCENT, CRON_SECRET } = process.env;

if (!MONGO_URI || !BOT_TOKEN || !SUPER_ADMIN_ID || !CRON_SECRET) {
    console.error("FATAL ERROR: Missing required environment variables (MONGO_URI, BOT_TOKEN, SUPER_ADMIN_ID, CRON_SECRET).");
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

// --- Internal Cron Job Endpoint ---
app.get('/api/internal/cron/check-subscriptions', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== CRON_SECRET) {
        return res.status(403).send('Forbidden: Invalid cron secret');
    }
    
    console.log('[CRON] Starting subscription check...');
    try {
        const expiredCount = await checkSubscriptions();
        console.log(`[CRON] Finished. ${expiredCount} users removed.`);
        res.status(200).send(`OK. ${expiredCount} users removed.`);
    } catch (error) {
        console.error('[CRON] Error during subscription check:', error);
        res.status(500).send('Cron job failed.');
    }
});

// =================================================================
// 5. PAYMENT & SUBSCRIPTION LOGIC
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
        
        const inviteLinkExpireDate = Math.floor(Date.now() / 1000) + (24 * 60 * 60);
        const inviteLink = await bot.createChatInviteLink(channel_id, { member_limit: 1, expire_date: inviteLinkExpireDate });
        
        await bot.sendMessage(subscriber_id, `✅ Payment confirmed! Your access to "${channel.channel_name}" is active.\n\nJoin using this **one-time link**: ${inviteLink.invite_link}\n\n_Note: This link will expire in 24 hours and can only be used once._`, { parse_mode: 'Markdown' });
        await bot.sendMessage(owner.telegram_id, `🎉 New Sale!\nA user subscribed to your channel "${channel.channel_name}" for ${plan_days} days.\n💰 ₹${amountToCredit.toFixed(2)} has been credited to your wallet.`);
        await bot.sendMessage(SUPER_ADMIN_ID, `💸 **Sale Confirmed!** (via ${method})\n\nOwner: ${owner.first_name}\nAmount: \`₹${plan_price.toFixed(2)}\`\nCommission: \`₹${commission.toFixed(2)}\`\nSubscriber: \`${subscriber_id}\``, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error("[processPayment] FATAL CRASH:", error);
        await bot.sendMessage(SUPER_ADMIN_ID, `❌ **CRITICAL ERROR during payment processing for ₹${amount}**\n\n\`${error.message}\`\n\nPlease check the logs.`);
    }
}

async function checkSubscriptions() {
    const now = new Date();
    const expiredSubs = await Subscriber.find({ expires_at: { $lte: now } }).populate({ path: 'channel_id_mongoose', model: 'ManagedChannel' });

    if (expiredSubs.length === 0) return 0;

    let removedCount = 0;
    for (const sub of expiredSubs) {
        try {
            const userId = sub.telegram_id;
            const channel = sub.channel_id_mongoose;
            
            if (!channel) { // If the channel was deleted from our DB
                await Subscriber.findByIdAndDelete(sub._id);
                continue;
            }
            
            const channelId = channel.channel_id;

            await bot.kickChatMember(channelId, userId);
            await bot.unbanChatMember(channelId, userId);

            const renewButton = { inline_keyboard: [[{ text: "🔄 Renew Subscription", url: `https://t.me/${(await bot.getMe()).username}?start=${channel.unique_start_key}` }]] };
            await bot.sendMessage(userId, `⌛️ **Your Subscription Has Expired**\n\nHello! Your subscription for the channel "**${channel.channel_name}**" has expired and you have been removed.\n\nTo regain access, please click the button below.`, { parse_mode: 'Markdown', reply_markup: renewButton });

            await Subscriber.findByIdAndDelete(sub._id);
            removedCount++;
        } catch (error) {
            console.error(`[CRON] Failed to process user ${sub.telegram_id}. Error: ${error.message}`);
            await Subscriber.findByIdAndDelete(sub._id);
        }
    }
    return removedCount;
}

// =================================================================
// 6. TELEGRAM BOT ROUTER
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
    return false;
}

bot.on('message', async (msg) => {
    const fromId = msg.from.id.toString();
    const text = msg.text || "";

    if (text.startsWith('/start ')) {
        return handleSubscriberMessage(bot, msg);
    }
    if (fromId === SUPER_ADMIN_ID) {
        const commandHandled = await handleSuperAdminCommands(bot, msg);
        if (commandHandled) return;
    }
    const owner = await Owner.findOne({ telegram_id: fromId });
    if (owner) {
        return handleOwnerMessage(bot, msg);
    }
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

bot.on("polling_error", (error) => console.log(`Polling Error: ${error.code} - ${error.message}`));
console.log('🤖 Bot is running...');

// =================================================================
// 7. START THE SERVER
// =================================================================
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
