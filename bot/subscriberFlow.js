const ManagedChannel = require('../models/managedChannel.model');
const PendingPayment = require('../models/pendingPayment.model');

let botInstance; // To hold the bot instance

module.exports = {
    initialize: (bot) => {
        botInstance = bot;
    },
    
    handleSubscriberMessage: async (bot, msg) => {
        // ... (puraana code bilkul same)
        const chatId = msg.chat.id;
        const text = msg.text;

        if (text.startsWith('/start ')) {
            const key = text.split(' ')[1];
            const channel = await ManagedChannel.findOne({ unique_start_key: key }).populate('owner_id');
            if (!channel) {
                await bot.sendMessage(chatId, `Sorry, this subscription link is invalid.`);
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
        } else {
            await bot.sendMessage(chatId, `Hello! To subscribe to a channel, please use a special link provided by the channel owner.`);
        }
    },

    handleSubscriberCallback: async (bot, cbq) => {
        // ... (yahan naya code add hua hai)
        const fromId = cbq.from.id.toString();
        const data = cbq.data;

        if (data.startsWith('sub_plan_')) {
            const [, , channelId, planDays] = data.split('_');
            const channel = await ManagedChannel.findById(channelId);
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
                channel_id_mongoose: channel._id // Store mongoose ObjectId for easier lookup
            });

            // --- NAYA FEATURE: ADMIN NOTIFICATION ---
            await botInstance.sendMessage(process.env.SUPER_ADMIN_ID, `🔔 New Payment Link Generated:\n\nUser: \`${fromId}\`\nAmount: \`₹${uniqueAmount}\`\nChannel: ${channel.channel_name}`, { parse_mode: 'Markdown'});
            // --- END OF NEW FEATURE ---
            
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
