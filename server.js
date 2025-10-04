// --- START OF FINAL PERMANENT FIX server.js FILE ---

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// Models
const Owner = require('./models/owner.model');
const ManagedChannel = require('./models/managedChannel.model');
const Subscriber = require('./models/subscriber.model');
const Transaction = require('./models/transaction.model');
const PendingPayment = require('./models/pendingPayment.model');
const Report = require('./models/report.model');

// Bot Logic (ownerFlow is separate)
const { handleOwnerMessage, handleOwnerCallback, initializeOwnerFlow } = require('./bot/ownerFlow');

// --- HELPER FUNCTION TO ESCAPE TELEGRAM MARKDOWN ---
function escapeMarkdownV2(text) {
    if (typeof text !== 'string') text = String(text);
    const escapeChars = '_*[]()~`>#+-=|{}.!';
    return text.replace(new RegExp(`[${escapeChars.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}]`, 'g'), '\\$&');
}

// Config
const { PORT, MONGO_URI, BOT_TOKEN, SUPER_ADMIN_ID, SUPER_ADMIN_USERNAME, AUTOMATION_SECRET, PLATFORM_COMMISSION_PERCENT, CRON_SECRET, RENDER_EXTERNAL_URL } = process.env;
if (!MONGO_URI || !BOT_TOKEN || !SUPER_ADMIN_ID || !SUPER_ADMIN_USERNAME || !CRON_SECRET) {
    console.error("FATAL ERROR: Missing critical environment variables.");
    process.exit(1);
}

const app = express();
let bot;
try {
    bot = new TelegramBot(BOT_TOKEN, { polling: true });
} catch (error) {
    console.error("Could not start Telegram Bot, check your token.", error.message);
    process.exit(1);
}

const userStates = {};
app.use(express.json()); app.use(express.text()); app.use(express.static('public'));

initializeOwnerFlow(userStates);

mongoose.connect(MONGO_URI).then(() => console.log('✅ MongoDB Connected!')).catch(err => { console.error('❌ MongoDB Connection Error:', err); process.exit(1); });

// --- API ROUTES ---
app.post('/api/shortcut', async (req, res) => {
    if (req.headers['x-shortcut-secret'] !== AUTOMATION_SECRET) return res.status(403).send('Unauthorized');
    const smsText = req.body;
    if (!smsText) return res.status(400).send('Bad Request');
    await bot.sendMessage(SUPER_ADMIN_ID, `🤖 Automated SMS Received:\n\`\`\`\n${smsText}\n\`\`\``, { parse_mode: 'MarkdownV2' });
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

app.get('/api/internal/cron', async (req, res) => {
    if (req.query.secret !== CRON_SECRET) return res.status(403).send('Forbidden');
    console.log('[CRON] Starting cron job...');
    try {
        const expiredCount = await checkSubscriptions(bot);
        const deletedBannedCount = await deleteOldBannedAccounts();
        const result = `OK. Expired Subs Removed: ${expiredCount}. Old Banned Accounts Deleted: ${deletedBannedCount}.`;
        console.log(`[CRON] Finished. ${result}`);
        res.status(200).send(result);
    } catch (error) {
        console.error('[CRON] Error:', error);
        res.status(500).send('Cron job failed.');
    }
});

// --- SMART UNIQUE AMOUNT GENERATOR ---
async function generateAndVerifyUniqueAmount(baseAmount) {
    let currentBase = Math.floor(baseAmount);
    let maxBaseAttempts = 5;
    for (let i = 0; i < maxBaseAttempts; i++) {
        let attemptsInCurrentRange = 0;
        while (attemptsInCurrentRange < 20) {
            const randomPaisa = Math.floor(Math.random() * 90) + 10;
            const candidateAmount = parseFloat((currentBase + randomPaisa / 100).toFixed(2));
            const existing = await PendingPayment.findOne({ unique_amount: candidateAmount });
            if (!existing) { return candidateAmount; }
            attemptsInCurrentRange++;
        }
        currentBase++;
    }
    throw new Error(`Failed to generate a unique payment amount.`);
}

// --- PAYMENT & CRON LOGIC ---
async function processPayment(amount, bot, method = "Unknown") {
    try {
        const payment = await PendingPayment.findOneAndDelete({ unique_amount: amount });
        if (!payment) {
            if (method.startsWith("Manual")) {
                await bot.sendMessage(SUPER_ADMIN_ID, `❌ *Verification Failed*\nNo pending payment found for amount \`₹${escapeMarkdownV2(String(amount))}\`\\.`, { parse_mode: 'MarkdownV2' });
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
        const safeChannelName = escapeMarkdownV2(channel.channel_name);
        await bot.sendMessage(subscriber_id, `✅ Payment confirmed\\! Your access to "*${safeChannelName}*" is active\\.\n\nJoin using this *one\\-time link*: ${inviteLink.invite_link}`, { parse_mode: 'MarkdownV2' });
        const reportKeyboard = { inline_keyboard: [[{ text: "⚠️ Report an Issue with this Channel", callback_data: `sub_report_${channel._id}` }]] };
        await bot.sendMessage(subscriber_id, "If you face any problems with the channel or owner, you can report it to the admin here\\.", { reply_markup: reportKeyboard, parse_mode: 'MarkdownV2' });
        const ownerMessage = `🎉 New Sale\\!\nA user subscribed to your channel "*${safeChannelName}*" for ${plan_days} days\\.\n💰 ₹${escapeMarkdownV2(amountToCredit.toFixed(2))} has been credited to your wallet\\.`;
        await bot.sendMessage(owner.telegram_id, ownerMessage, { parse_mode: 'MarkdownV2' });
        const adminMessage = `💸 *Sale Confirmed\\!* \\(via ${escapeMarkdownV2(method)}\\)\n\nOwner: ${escapeMarkdownV2(owner.first_name)}\nAmount: \`₹${plan_price.toFixed(2)}\`\nCommission: \`₹${commission.toFixed(2)}\`\nSubscriber: \`${subscriber_id}\``;
        await bot.sendMessage(SUPER_ADMIN_ID, adminMessage, { parse_mode: 'MarkdownV2' });
    } catch (error) {
        console.error("[processPayment] FATAL CRASH:", error);
        const finalMessage = `❌ *CRITICAL ERROR* during payment processing for ₹${escapeMarkdownV2(String(amount))}\n\n*Error Details:*\n\`\`\`\n${error.message || 'Unknown error'}\n\`\`\``;
        await bot.sendMessage(SUPER_ADMIN_ID, finalMessage, { parse_mode: 'MarkdownV2' });
    }
}

// --- SUBSCRIBER LOGIC ---
async function handleSubscriberMessage(bot, msg) {
    const fromId = msg.from.id.toString();
    const text = msg.text || "";
    if (text.startsWith('/start ')) {
        const uniqueKey = text.split(' ')[1];
        const channel = await ManagedChannel.findOne({ unique_start_key: uniqueKey }).populate('owner_id');
        if (!channel) { return bot.sendMessage(fromId, "This link seems to be invalid or expired\\. Please contact the channel owner for a new link\\.", { parse_mode: 'MarkdownV2' }); }
        userStates[fromId] = { channel_id: channel.channel_id, channel_id_mongoose: channel._id, owner_id: channel.owner_id._id };
        const safeChannelName = escapeMarkdownV2(channel.channel_name);
        const welcomeMessage = `Welcome to *${safeChannelName}*\\!\n\nPlease select a subscription plan:`;
        const planButtons = channel.plans.map(plan => ([{ text: `${plan.days} Days for ₹${plan.price}`, callback_data: `sub_plan_${plan.days}_${plan.price}` }]));
        await bot.sendMessage(fromId, welcomeMessage, { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: planButtons } });
        return;
    }
    await bot.sendMessage(fromId, "Please use the special link provided by the channel owner to start the subscription process\\.", { parse_mode: 'MarkdownV2' });
}

async function handleSubscriberCallback(bot, callbackQuery) {
    const fromId = callbackQuery.from.id.toString();
    const data = callbackQuery.data;
    if (data.startsWith('sub_plan_')) {
        await bot.answerCallbackQuery(callbackQuery.id);
        const parts = data.split('_');
        const days = parseInt(parts[2], 10);
        const price = parseFloat(parts[3]);
        const state = userStates[fromId];
        if (!state) { return bot.sendMessage(fromId, "Something went wrong, your session has expired\\. Please use the start link again\\.", { parse_mode: 'MarkdownV2' }); }
        try {
            const uniqueAmount = await generateAndVerifyUniqueAmount(price);
            const formattedAmount = uniqueAmount.toFixed(2);
            await PendingPayment.create({ subscriber_id: fromId, owner_id: state.owner_id, channel_id: state.channel_id, channel_id_mongoose: state.channel_id_mongoose, plan_days: days, plan_price: price, unique_amount: uniqueAmount });
            const channel = await ManagedChannel.findById(state.channel_id_mongoose);
            const adminNotification = `🔔 New Payment Link Generated:\nUser: \`${fromId}\`\nAmount: \`₹${formattedAmount}\`\nChannel: ${channel.channel_name}`;
            await bot.sendMessage(SUPER_ADMIN_ID, adminNotification, { parse_mode: 'Markdown' });
            const paymentMessage = `Great\\! To get the *${days} Days Plan*, please pay exactly *₹${escapeMarkdownV2(formattedAmount)}* using the link below\\.\n\n*This link will expire in 5 minutes\\.*`;
            const paymentUrl = `${RENDER_EXTERNAL_URL}/?amount=${formattedAmount}`;
            await bot.sendMessage(fromId, paymentMessage, { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [[{ text: `Pay ₹${formattedAmount} Now`, url: paymentUrl }]] } });
        } catch (error) {
            console.error("Error generating payment link:", error);
            await bot.sendMessage(fromId, "Sorry, we couldn't generate a payment link right now\\. Please try again in a moment\\.", { parse_mode: 'MarkdownV2' });
        }
    }
}

// --- MAIN TELEGRAM ROUTER ---
bot.on('message', async (msg) => {
    try {
        const fromId = msg.from.id.toString();
        const text = msg.text || "";
        const state = userStates[fromId];
        if (state && state.awaiting === 'report_reason') {
            const { channelId } = state; const channel = await ManagedChannel.findById(channelId).populate('owner_id');
            await Report.create({ reporter_id: fromId, reported_owner_id: channel.owner_id._id, reported_channel_id: channel._id, reason: text });
            await bot.sendMessage(fromId, "✅ Thank you for your report\\. The admin has been notified\\.", { parse_mode: 'MarkdownV2' });
            const safeOwnerName = escapeMarkdownV2(channel.owner_id.first_name);
            const safeChannelName = escapeMarkdownV2(channel.channel_name);
            const safeReason = escapeMarkdownV2(text);
            const reportMessage = `🚨 *New Report\\!* 🚨\n\n*From User:* \`${fromId}\`\n*Against Owner:* ${safeOwnerName} \\(\`${channel.owner_id.telegram_id}\`\\)\n*For Channel:* ${safeChannelName}\n\n*Reason:*\n${safeReason}`;
            await bot.sendMessage(SUPER_ADMIN_ID, reportMessage, { parse_mode: 'MarkdownV2' });
            delete userStates[fromId]; return;
        }
        if (fromId === SUPER_ADMIN_ID) { const commandHandled = await handleSuperAdminCommands(bot, msg); if (commandHandled) return; }
        if (text.startsWith('/start ')) { return handleSubscriberMessage(bot, msg); }
        const owner = await Owner.findOne({ telegram_id: fromId });
        if (owner) { return handleOwnerMessage(bot, msg); }
        return handleSubscriberMessage(bot, msg);
    } catch (error) {
        console.error("!!! MESSAGE HANDLER CRASHED !!!", error);
        const errorMessage = `🚨 *BOT CRASH in message handler*\n\n*Error Details:*\n\`\`\`\n${error.message || 'Unknown error'}\n\`\`\``;
        bot.sendMessage(SUPER_ADMIN_ID, errorMessage, { parse_mode: 'MarkdownV2' });
    }
});

bot.on('callback_query', async (callbackQuery) => {
    try {
        const fromId = callbackQuery.from.id.toString(); const data = callbackQuery.data || "";
        if (fromId === SUPER_ADMIN_ID && data.startsWith('admin_')) { return handleAdminCallback(bot, callbackQuery); }
        if (data.startsWith('sub_report_')) { const channelId = data.split('_')[2]; userStates[fromId] = { awaiting: 'report_reason', channelId }; await bot.answerCallbackQuery(callbackQuery.id); await bot.sendMessage(fromId, "Please describe the issue you are facing\\. Your message will be sent to the admin\\.", { parse_mode: 'MarkdownV2' }); return; }
        if (data.startsWith('sub_')) { await handleSubscriberCallback(bot, callbackQuery); }
        else if (data.startsWith('owner_')) { await handleOwnerCallback(bot, callbackQuery); }
    } catch (error) {
        console.error("!!! CALLBACK HANDLER CRASHED !!!", error);
        const errorMessage = `🚨 *BOT CRASH in callback handler*\n\n*Error Details:*\n\`\`\`\n${error.message || 'Unknown error'}\n\`\`\``;
        bot.sendMessage(SUPER_ADMIN_ID, errorMessage, { parse_mode: 'MarkdownV2' });
    }
});

bot.on('polling_error', (error) => console.error(`POLLING ERROR: ${error.code} - ${error.message}`));

console.log('🤖 Bot is running...');
app.listen(PORT, () => console.log(`🚀 Server is running on http://localhost:${PORT}`));

// --- ADMIN & OTHER UNCHANGED/FIXED FUNCTIONS ---
async function checkSubscriptions(bot) { const now = new Date(); const expiredSubs = await Subscriber.find({ expires_at: { $lte: now } }).populate({ path: 'channel_id_mongoose', model: 'ManagedChannel' }); if (expiredSubs.length === 0) return 0; let removedCount = 0; for (const sub of expiredSubs) { try { const userId = sub.telegram_id; const channel = sub.channel_id_mongoose; if (!channel) { await Subscriber.findByIdAndDelete(sub._id); continue; } const channelId = channel.channel_id; await bot.kickChatMember(channelId, userId); await bot.unbanChatMember(channelId, userId); const renewButton = { inline_keyboard: [[{ text: "🔄 Renew Subscription", url: `https://t.me/${(await bot.getMe()).username}?start=${channel.unique_start_key}` }]] }; const safeChannelName = escapeMarkdownV2(channel.channel_name); await bot.sendMessage(userId, `⌛️ *Your Subscription Has Expired*\n\nYour subscription for "*${safeChannelName}*" has expired and you have been removed\\.`, { parse_mode: 'MarkdownV2', reply_markup: renewButton }); await Subscriber.findByIdAndDelete(sub._id); removedCount++; } catch (error) { console.error(`[CRON] Failed to process user ${sub.telegram_id}. Error: ${error.message}`); await Subscriber.findByIdAndDelete(sub._id); } } return removedCount; }
async function deleteOldBannedAccounts() { const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); const result = await Owner.deleteMany({ is_banned: true, banned_at: { $lte: sevenDaysAgo } }); return result.deletedCount; }
async function handleSuperAdminCommands(bot, msg) { const text = msg.text || ""; const fromId = msg.from.id.toString(); if (text === '/superhelp') { const keyboard = { inline_keyboard: [[{ text: "🚨 Manual Verification", callback_data: "admin_superhelpsection_verification" }], [{ text: "👑 Admin Dashboard Explained", callback_data: "admin_superhelpsection_dashboard" }], [{ text: "🔑 Moderation Commands", callback_data: "admin_superhelpsection_moderation" }], ]}; await bot.sendMessage(fromId, "Welcome, Super Admin\\! This is your special help section\\.", { reply_markup: keyboard, parse_mode: 'MarkdownV2' }); return true; } const amountMatch = text.match(/(\d+\.\d{2})/); if (amountMatch && amountMatch[1]) { const amount = amountMatch[1]; await bot.sendMessage(fromId, `Received amount ₹${escapeMarkdownV2(amount)}\\. Attempting manual verification\\.\\.\\.`, { parse_mode: 'MarkdownV2' }); await processPayment(amount, bot, "Manual (Admin)"); return true; } if (text === '/viewowners') { const owners = await Owner.find({}).sort({ created_at: -1 }).limit(10); if (owners.length === 0) return bot.sendMessage(fromId, "No owners have registered yet\\.", { parse_mode: 'MarkdownV2' }); const keyboard = owners.map(o => ([{ text: `${escapeMarkdownV2(o.first_name)} (${o.telegram_id}) ${o.is_banned ? '- 🚫 BANNED' : ''}`, callback_data: `admin_inspect_${o._id}` }])); bot.sendMessage(fromId, "Here are the most recent owners\\. Select one to manage:", { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2' }); return true; } if (text.startsWith('/unban ')) { const ownerId = text.split(' ')[1]; const owner = await Owner.findOneAndUpdate({ telegram_id: ownerId }, { is_banned: false, $unset: { banned_at: "" } }); if (owner) { bot.sendMessage(owner.telegram_id, `✅ Good News\\! Your account has been unbanned by the admin\\.`, { parse_mode: 'MarkdownV2' }); bot.sendMessage(fromId, `✅ Owner ${escapeMarkdownV2(owner.first_name)} has been unbanned\\.`, { parse_mode: 'MarkdownV2' }); } else { bot.sendMessage(fromId, "Owner not found with that Telegram ID\\.", { parse_mode: 'MarkdownV2' }); } return true; } if (text.startsWith('/removesubscriber ')) { const parts = text.split(' '); if (parts.length !== 3) return bot.sendMessage(fromId, "Invalid format\\. Use:\n/removesubscriber <USER\\_ID> <CHANNEL\\_ID>", { parse_mode: 'MarkdownV2' }); const [, subscriberId, channelId] = parts; try { await bot.kickChatMember(channelId, subscriberId); await bot.unbanChatMember(channelId, subscriberId); const result = await Subscriber.deleteOne({ telegram_id: subscriberId, channel_id: channelId }); if (result.deletedCount > 0) { bot.sendMessage(subscriberId, "Your subscription has been manually revoked by an admin\\.").catch(() => { }); bot.sendMessage(fromId, `✅ Success\\! User ${subscriberId} removed from channel ${channelId}\\.`, { parse_mode: 'MarkdownV2' }); } else { bot.sendMessage(fromId, `⚠️ User ${subscriberId} not in DB for channel ${channelId}, but kick command sent\\.`, { parse_mode: 'MarkdownV2' }); } } catch (error) { const errorMessage = `❌ *Error removing subscriber:*\n\n\`\`\`\n${error.message || 'Unknown error'}\n\`\`\``; bot.sendMessage(fromId, errorMessage, { parse_mode: 'MarkdownV2' }); } return true; } return false; }
async function handleAdminCallback(bot, cbq) { const fromId = cbq.from.id.toString(); const data = cbq.data; const parts = data.split('_'); const action = parts[1]; const objectId = parts[2]; if (action === 'inspect') { const owner = await Owner.findById(objectId); const channels = await ManagedChannel.find({ owner_id: objectId }); let text = `*Inspecting ${escapeMarkdownV2(owner.first_name)}* \\(\`${owner.telegram_id}\`\\)\n\n*Status:* ${owner.is_banned ? '🚫 BANNED' : '✅ Active'}\n*Wallet:* ₹${escapeMarkdownV2(owner.wallet_balance.toFixed(2))}`; const keyboard = channels.map(c => ([{ text: escapeMarkdownV2(c.channel_name), callback_data: `admin_getlink_${c._id}` }])); if (!owner.is_banned) { keyboard.push([{ text: `🚫 BAN THIS OWNER`, callback_data: `admin_ban_${objectId}` }]); } keyboard.push([{ text: `⬅️ Back to Owner List`, callback_data: `admin_viewowners` }]); bot.editMessageText(text, { chat_id: fromId, message_id: cbq.message.message_id, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } }); } if (action === 'getlink') { const channel = await ManagedChannel.findById(objectId); const link = await bot.createChatInviteLink(channel.channel_id, { member_limit: 1 }); bot.sendMessage(fromId, `Here is the one\\-time inspection link for *${escapeMarkdownV2(channel.channel_name)}*:\n\n${link.invite_link}`, { parse_mode: 'MarkdownV2' }); } if (action === 'ban') { const owner = await Owner.findByIdAndUpdate(objectId, { is_banned: true, banned_at: new Date() }); await ManagedChannel.deleteMany({ owner_id: objectId }); bot.sendMessage(owner.telegram_id, `⚠️ *Your Account Has Been Banned* ⚠️\n\nThis is due to a violation of our terms\\. Your channels have been removed and withdrawals are disabled\\.\n\nPlease contact support: @${SUPER_ADMIN_USERNAME}`, { parse_mode: 'MarkdownV2' }); bot.editMessageText(`✅ Owner ${escapeMarkdownV2(owner.first_name)} has been banned\\.`, { chat_id: fromId, message_id: cbq.message.message_id, parse_mode: 'MarkdownV2' }); } if (action === 'viewowners') { const owners = await Owner.find({}).sort({ created_at: -1 }).limit(10); const keyboard = owners.map(o => ([{ text: `${escapeMarkdownV2(o.first_name)} (${o.telegram_id}) ${o.is_banned ? '- 🚫 BANNED' : ''}`, callback_data: `admin_inspect_${o._id}` }])); bot.editMessageText("Select an owner to inspect:", { chat_id: fromId, message_id: cbq.message.message_id, reply_markup: { inline_keyboard: keyboard }, parse_mode: 'MarkdownV2' }); } if (action === 'superhelpsection') { const helpContent = { verification: `*🚨 Manual Payment Verification*\n\nWhen the automatic \\(SMS\\) system fails, you can manually verify a payment\\. You will get a notification with a *Unique Amount* \\(e\\.g\\., \`₹100.17\`\\)\\. Just send this amount \\(e\\.g\\., \`100.17\`\\) to the bot, and it will process the payment\\.`, dashboard: `*👑 Admin Dashboard Explained*\n\nYour web dashboard is your master control room\\. The "Financials" section shows:\n\n- *Total Paid to Owners:* Money you have successfully sent\\.\n- *Pending Payouts:* Total money in all owners' wallets that you are liable to pay out\\.`, moderation: `*🔑 Moderation Commands*\n\n- \`/viewowners\`: See a list of all channel owners\\.\n- \`/unban <USER_ID>\`: Unban an owner\\.\n- \`/removesubscriber <USER_ID> <CHANNEL_ID>\`: Forcibly remove a subscriber from a channel\\.` }; await bot.editMessageText(helpContent[objectId], { chat_id: fromId, message_id: cbq.message.message_id, parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "admin_superhelp" }]] } }); } if (action === 'superhelp') { const keyboard = { inline_keyboard: [[{ text: "🚨 Manual Verification", callback_data: "admin_superhelpsection_verification" }], [{ text: "👑 Admin Dashboard Explained", callback_data: "admin_superhelpsection_dashboard" }], [{ text: "🔑 Moderation Commands", callback_data: "admin_superhelpsection_moderation" }],] }; await bot.editMessageText("Welcome, Super Admin\\! This is your special help section\\.", { chat_id: fromId, message_id: cbq.message.message_id, reply_markup: keyboard, parse_mode: 'MarkdownV2' }); } }

// --- END OF FINAL PERMANENT FIX server.js FILE ---
