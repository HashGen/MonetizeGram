const ManagedChannel = require('../models/managedChannel.model');
const PendingPayment = require('../models/pendingPayment.model');

let botInstance;
let userStatesRef;

function initializeSubscriberFlow(bot, userStates) {
    botInstance = bot;
    userStatesRef = userStates;
}

async function handleSubscriberMessage(bot, msg) {
    // ... (This part is unchanged)
}

async function handleSubscriberCallback(bot, cbq) {
    const fromId = cbq.from.id.toString();
    const data = cbq.data;

    if (data.startsWith('sub_plan_')) {
        const [, , channelId, planDays] = data.split('_');
        const channel = await ManagedChannel.findById(channelId);
        if (!channel) { await bot.answerCallbackQuery(cbq.id, { text: "This channel is no longer on our platform.", show_alert: true }); return; }

        const plan = channel.plans.find(p => p.days.toString() === planDays);
        if (!plan) { await bot.answerCallbackQuery(cbq.id, { text: "This plan is no longer available.", show_alert: true }); return; }

        // --- THIS IS THE FINAL, CORRECT FIX ---
        // New, more powerful unique amount generation that works with SMS
        
        // 1. Create random cents (paise) between .10 and .99
        const randomCents = (Math.floor(Math.random() * 90) + 10) / 100;
        
        // 2. Create a small random number to add or subtract from the main price (e.g., -5 to +5)
        const randomVariation = Math.floor(Math.random() * 11) - 5; // -5, -4, ..., 0, ..., 4, 5
        
        // 3. Calculate the new unique amount and format it to 2 decimal places
        const uniqueAmount = (plan.price + randomVariation + randomCents).toFixed(2);
        // --- END OF FIX ---

        await PendingPayment.create({
            unique_amount: uniqueAmount,
            subscriber_id: fromId,
            owner_id: channel.owner_id,
            channel_id: channel.channel_id,
            plan_days: plan.days,
            plan_price: plan.price,
            channel_id_mongoose: channel._id
        });
        
        await botInstance.sendMessage(process.env.SUPER_ADMIN_ID, `🔔 New Payment Link Generated:\n\nUser: \`${fromId}\`\nAmount: \`₹${uniqueAmount}\`\nChannel: ${channel.channel_name}`, { parse_mode: 'Markdown'});
        
        const paymentUrl = `${process.env.YOUR_DOMAIN}/?amount=${uniqueAmount}`;
        await bot.sendMessage(fromId, `Great! To get the *${plan.days} Days Plan*, please pay exactly *₹${uniqueAmount}* using the link below.`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: `Pay ₹${uniqueAmount} Now`, url: paymentUrl }]]
            }
        });
        await bot.answerCallbackQuery(cbq.id);
    }
}

// Full code below for safety
async function handleSubscriberMessage(bot, msg) {
    const chatId = msg.chat.id; const text = msg.text;
    if (text.startsWith('/start ')) {
        const key = text.split(' ')[1];
        const channel = await ManagedChannel.findOne({ unique_start_key: key });
        if (!channel) { await bot.sendMessage(chatId, `Sorry, this subscription link is invalid or has expired.`); return; }
        const keyboard = channel.plans.map(plan => ([{ text: `${plan.days} Days for ₹${plan.price}`, callback_data: `sub_plan_${channel._id}_${plan.days}` }]));
        await bot.sendMessage(chatId, `Welcome to *${channel.channel_name}*!\n\nPlease select a subscription plan:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    } else {
        const welcomeText = `👋 *Welcome to MonetizeGram!*\n\nThe ultimate platform to monetize your Telegram channel or join exclusive premium content.\n\nWhat would you like to do today?`;
        const keyboard = { inline_keyboard: [ [{ text: "🚀 Monetize My Channel", callback_data: "owner_add" }], [{ text: "❓ How it Works", callback_data: "owner_help" }] ] };
        await bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
}

module.exports = {
    initializeSubscriberFlow,
    handleSubscriberMessage,
    handleSubscriberCallback
};
