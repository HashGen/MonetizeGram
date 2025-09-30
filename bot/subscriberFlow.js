const ManagedChannel = require('../models/managedChannel.model');
const PendingPayment = require('../models/pendingPayment.model');

let botInstance;
let userStatesRef; // Reference to the userStates object from server.js

module.exports = {
    initialize: (bot, userStates) => {
        botInstance = bot;
        userStatesRef = userStates;
    },
    
    handleSubscriberMessage: async (bot, msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        // Case 1: User clicks a special subscriber link (.../start=key)
        if (text.startsWith('/start ')) {
            const key = text.split(' ')[1];
            const channel = await ManagedChannel.findOne({ unique_start_key: key });
            if (!channel) {
                await bot.sendMessage(chatId, `Sorry, this subscription link is invalid or has expired.`);
                return;
            }
            
            const keyboard = channel.plans.map(plan => ([{
                text: `${plan.days} Days for ₹${plan.price}`,
                callback_data: `sub_plan_${channel._id}_${plan.days}`
            }]));

            await bot.sendMessage(chatId, `Welcome to *${channel.channel_name}*!\n\nPlease select a subscription plan:`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        
        // Case 2: A brand new user types /start
        } else {
            const welcomeText = `
👋 *Welcome to Make Paid Bot!*

_The Ultimate Platform To Monetize Your Telegram Channel Or Join Exclusive Premium Content._

_What Would You Like To Do Today?_
            `;

            const keyboard = {
                inline_keyboard: [
                    [{ text: "🚀 Monetize My Channel", callback_data: "owner_add" }],
                    [{ text: "❓ How It Works", callback_data: "owner_help" }]
                ]
            };

            await bot.sendMessage(chatId, welcomeText, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    },

    handleSubscriberCallback: async (bot, cbq) => {
        const fromId = cbq.from.id.toString();
        const data = cbq.data;

        if (data.startsWith('sub_plan_')) {
            const [, , channelId, planDays] = data.split('_');
            const channel = await ManagedChannel.findById(channelId);
            if (!channel) {
                await bot.answerCallbackQuery(cbq.id, { text: "This channel is no longer on our platform.", show_alert: true });
                return;
            }

            const plan = channel.plans.find(p => p.days.toString() === planDays);
            if (!plan) {
                await bot.answerCallbackQuery(cbq.id, { text: "This plan is no longer available.", show_alert: true });
                return;
            }

            const uniqueAmount = `${plan.price}.${Math.floor(Math.random() * 90) + 10}`;
            
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
};
