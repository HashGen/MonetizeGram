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
const superAdminRoutes = require('./api/superAdmin'); // We will create this file later if needed
app.use('/api/super', superAdminRoutes(bot)); // Pass bot instance to routes

// iPhone Shortcut Payment Verification Endpoint
app.post('/api/shortcut', async (req, res) => {
    if (req.headers['x-shortcut-secret'] !== AUTOMATION_SECRET) {
        return res.status(403).send('Unauthorized');
    }
    const smsText = req.body;
    if (!smsText) return res.status(400).send('Bad Request');
    
    await bot.sendMessage(SUPER_ADMIN_ID, `🤖 Automated SMS Received:\n---\n${smsText}\n---`);
    await processPaymentFromSms(smsText, bot);
    res.status(200).send('OK');
});


// =================================================================
// 5. PAYMENT PROCESSING LOGIC
// =================================================================
async function processPaymentFromSms(smsText, bot) {
    const amountRegex = /(?:Rs\.?|₹|INR)\s*([\d,]+\.\d{2})/;
    const match = smsText.match(amountRegex);
    if (!match || !match[1]) return;
    
    const amount = match[1].replace(/,/g, '');
    const payment = await PendingPayment.findOneAndDelete({ unique_amount: amount });

    if (!payment) {
        console.log(`No pending payment found for amount: ${amount}`);
        return;
    }

    const { subscriber_id, owner_id, channel_id, plan_days, plan_price } = payment;
    
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
    await bot.sendMessage(subscriber_id, `✅ Payment confirmed! Your access is active.\n\nJoin using this one-time link: ${inviteLink.invite_link}`);
    await bot.sendMessage(owner.telegram_id, `🎉 New Sale! A user subscribed to your channel for ${plan_days} days. ₹${amountToCredit.toFixed(2)} has been credited to your wallet.`);
    await bot.sendMessage(SUPER_ADMIN_ID, `💸 New Platform Sale!\nOwner: ${owner.first_name}\nAmount: ₹${plan_price}\nCommission: ₹${commission.toFixed(2)}`);
}


// =================================================================
// 6. TELEGRAM BOT ROUTER
// =================================================================
bot.on('message', async (msg) => {
    const fromId = msg.from.id.toString();

    if (msg.text && msg.text.startsWith('/start ')) {
        await handleSubscriberMessage(bot, msg);
    } else if (fromId === SUPER_ADMIN_ID) {
        // Handle Super Admin specific commands later
        await handleOwnerMessage(bot, msg); // For now, let admin act as owner for testing
    } else {
        // Check if user is an owner or a new subscriber
        const owner = await Owner.findOne({ telegram_id: fromId });
        if (owner) {
            await handleOwnerMessage(bot, msg);
        } else {
            await handleSubscriberMessage(bot, msg);
        }
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const fromId = callbackQuery.from.id.toString();

    if (callbackQuery.data.startsWith('sub_')) {
        await handleSubscriberCallback(bot, callbackQuery);
    } else if (callbackQuery.data.startsWith('owner_')) {
         await handleOwnerCallback(bot, callbackQuery);
    }
});

bot.on("polling_error", console.log);
console.log('🤖 Bot is running...');

// =================================================================
// 7. START THE SERVER
// =================================================================
// This part is for the superAdmin API, which we can build later. For now, it's a placeholder.
const superAdminApi = require('./api/superAdmin');
app.use('/api/super', superAdminApi(bot));

app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
