// =================================================================
// 1. SETUP & IMPORTS
// =================================================================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// --- Import All Models ---
const Owner = require('./models/owner.model');
const ManagedChannel = require('./models/managedChannel.model');
const Subscriber = require('./models/subscriber.model');
const Transaction = require('./models/transaction.model');
const Withdrawal = require('./models/withdrawal.model');
const PendingPayment = require('./models/pendingPayment.model');

// --- Import Bot Logic ---
const { handleOwnerMessage, handleOwnerCallback } = require('./bot/ownerFlow');
const { handleSubscriberMessage, handleSubscriberCallback } = require('./bot/subscriberFlow');

// =================================================================
// 2. CONFIGURATION & INITIALIZATION
// =================================================================
const { PORT, MONGO_URI, BOT_TOKEN, SUPER_ADMIN_ID, AUTOMATION_SECRET, PLATFORM_COMMISSION_PERCENT } = process.env;

if (!MONGO_URI || !BOT_TOKEN || !SUPER_ADMIN_ID) {
    console.error("FATAL ERROR: MONGO_URI, BOT_TOKEN, and SUPER_ADMIN_ID are required.");
    process.exit(1);
}

const app = express();
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
app.use(express.json());
app.use(express.text());
app.use(express.static('public'));

// Pass bot instance to other modules that need it
require('./bot/subscriberFlow').initialize(bot);

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
// iPhone Shortcut Payment Verification Endpoint
app.post('/api/shortcut', async (req, res) => {
    if (req.headers['x-shortcut-secret'] !== AUTOMATION_SECRET) {
        return res.status(403).send('Unauthorized');
    }
    const smsText = req.body;
    if (!smsText) return res.status(400).send('Bad Request');
    
    await bot.sendMessage(SUPER_ADMIN_ID, `🤖 Automated SMS Received:\n---\n${smsText}\n---`);
    
    // Extract amount and process payment
    const amountRegex = /(?:Rs\.?|₹|INR)\s*([\d,]+\.\d{2})/;
    const match = smsText.match(amountRegex);
    if (match && match[1]) {
        const amount = match[1].replace(/,/g, '');
        await processPayment(amount, bot, "Automatic (SMS)");
    }
    
    res.status(200).send('OK');
});

// Placeholder for Super Admin Dashboard APIs
const superAdminApi = require('./api/superAdmin');
app.use('/api/super', superAdminApi(bot));


// =================================================================
// 5. PAYMENT PROCESSING LOGIC (The Core Brain)
// =================================================================
async function processPayment(amount, bot, method = "Unknown") {
    const payment = await PendingPayment.findOneAndDelete({ unique_amount: amount });

    if (!payment) {
        console.log(`No pending payment found for amount: ${amount}`);
        // Notify admin only if the method is manual
        if (method.startsWith("Manual")) {
            await bot.sendMessage(SUPER_ADMIN_ID, `❌ No pending payment found for amount ₹${amount}. It might have expired or already been processed.`);
        }
        return;
    }

    const { subscriber_id, owner_id, channel_id, plan_days, plan_price } = payment;
    
    const channel = await ManagedChannel.findById(payment.channel_id_mongoose);
    if (!channel) return console.log("Channel not found during processing");
    
    // Calculate commission
    const commission = (plan_price * PLATFORM_COMMISSION_PERCENT) / 100;
    const amountToCredit = plan_price - commission;

    // Create a transaction record
    await Transaction.create({
        owner_id, subscriber_id, channel_id, plan_days,
        amount_paid: plan_price,
        commission_charged: commission,
        amount_credited_to_owner: amountToCredit
    });

    // Update owner's wallet
    const owner = await Owner.findByIdAndUpdate(owner_id, { $inc: { wallet_balance: amountToCredit, total_earnings: plan_price } });

    // Add user to subscribers list
    const expiryDate = new Date(Date.now() + plan_days * 24 * 60 * 60 * 1000);
    await Subscriber.findOneAndUpdate(
        { telegram_id: subscriber_id, channel_id: channel_id },
        { expires_at: expiryDate, owner_id: owner.telegram_id, subscribed_at: new Date() },
        { upsert: true }
    );
    
    // Create one-time invite link
    const inviteLink = await bot.createChatInviteLink(channel_id, { member_limit: 1 });
    
    // Notify everyone
    await bot.sendMessage(subscriber_id, `✅ Payment confirmed! Your access to "${channel.channel_name}" is active.\n\nJoin using this one-time link: ${inviteLink.invite_link}`);
    await bot.sendMessage(owner.telegram_id, `🎉 New Sale!\nA user subscribed to your channel "${channel.channel_name}" for ${plan_days} days.\n💰 ₹${amountToCredit.toFixed(2)} has been credited to your wallet.`);
    await bot.sendMessage(SUPER_ADMIN_ID, `💸 New Platform Sale! (via ${method})\nOwner: ${owner.first_name}\nAmount: ₹${plan_price.toFixed(2)}\nCommission: ₹${commission.toFixed(2)}`);
}

// =================================================================
// 6. TELEGRAM BOT ROUTER
// =================================================================

async function handleSuperAdminCommands(bot, msg) {
    const text = msg.text || "";
    const fromId = msg.from.id.toString();

    // FEATURE: Manual Verification by sending unique amount
    const amountMatch = text.match(/^(\d+\.\d{2})$/);
    if (amountMatch) {
        const amount = amountMatch[1];
        await bot.sendMessage(fromId, `Received amount ₹${amount}. Attempting manual verification...`);
        await processPayment(amount, bot, "Manual (Admin)");
        return;
    }

    // FEATURE: Manual Subscriber Add Command
    if (text.startsWith('/addsubscriber ')) {
        const parts = text.split(' ');
        if (parts.length !== 4) {
            return bot.sendMessage(fromId, "Invalid format. Use:\n/addsubscriber <user_id> <channel_id> <days>");
        }
        const [, subscriberId, channelId, days] = parts;
        // ... (manual add logic from previous answer)
        // This is a more forceful method that bypasses payment logic
        await bot.sendMessage(fromId, "Manual subscriber add command executed."); // Placeholder
        return;
    }
}


bot.on('message', async (msg) => {
    const fromId = msg.from.id.toString();
    const text = msg.text || "";

    if (fromId === SUPER_ADMIN_ID) {
        await handleSuperAdminCommands(bot, msg);
        // We stop here so admin commands don't trigger other flows
        return; 
    }
    
    if (text.startsWith('/start ')) {
        await handleSubscriberMessage(bot, msg);
    } else {
        const owner = await Owner.findOne({ telegram_id: fromId });
        if (owner) {
            await handleOwnerMessage(bot, msg);
        } else {
            await handleSubscriberMessage(bot, msg);
        }
    }
});

bot.on('callback_query', async (callbackQuery) => {
    // This logic remains the same
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
