// subscriberFlow.js (UPDATED & COMPLETE)

const ManagedChannel = require('../models/managedChannel.model');
const PendingPayment = require('../models/pendingPayment.model');

// server.js se function import kar rahe hain
const { generateAndVerifyUniqueAmount } = require('../server');

let botInstance;
let userStatesRef;

function initializeSubscriberFlow(bot, userStates) {
    botInstance = bot;
    userStatesRef = userStates;
}

async function handleSubscriberMessage(bot, msg) {
    // Is function mein koi change nahi hai
    const chatId = msg.chat.id;
    const text = msg.text;

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
    
    } else {
        const welcomeText = `
👋 *Welcome to MonetizeGram!*

The ultimate platform to monetize your Telegram channel or join exclusive premium content.

What would you like to do today?
        `;
        const keyboard = {
            inline_keyboard: [
                [{ text: "🚀 Monetize My Channel", callback_data: "owner_add" }],
                [{ text: "❓ How it Works", callback_data: "owner_help" }]
            ]
        };
        await bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
}

async function handleSubscriberCallback(bot, cbq) {
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

        try {
            const uniqueAmount = await generateAndVerifyUniqueAmount(plan.price);
            
            // Database mein entry create karo
            const pendingDoc = await PendingPayment.create({
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
            
            // User ko payment button bhejo aur message ko save karo
            const sentMessage = await bot.sendMessage(fromId, `Great! To get the *${plan.days} Days Plan*, please pay exactly *₹${uniqueAmount}* using the link below.\n\n*This link will expire in 5 minutes.*`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: `Pay ₹${uniqueAmount} Now`, url: paymentUrl }]]
                }
            });
            
            await bot.answerCallbackQuery(cbq.id);

            // --- YAHAN SE HOGA MAGIC ---
            // 5 MINUTE KA TIMER SET KARO (300000 milliseconds)
            setTimeout(async () => {
                try {
                    // 5 min baad, database se is entry ko delete karne ki koshish karo
                    const deletedPayment = await PendingPayment.findOneAndDelete({ _id: pendingDoc._id });

                    // Agar entry delete hui (matlab user ne payment nahi ki thi)
                    if (deletedPayment) {
                        console.log(`Expired payment link for ₹${uniqueAmount} deleted for user ${fromId}`);
                        // User ke chat mein jaakar purane message ko EDIT kar do
                        await bot.editMessageText(
                            `❌ **Payment Link Expired**\n\nThe link for amount ₹${uniqueAmount} has expired. Please generate a new one.`, 
                            {
                                chat_id: sentMessage.chat.id,
                                message_id: sentMessage.message_id,
                                reply_markup: { // Button hata do
                                    inline_keyboard: []
                                }
                            }
                        );
                    }
                } catch (error) {
                    // Agar message edit karte waqt error aaye (ho sakta hai user ne chat delete kar di ho)
                    // toh bas console mein log kardo, bot crash nahi hoga
                    console.error(`Could not edit expired payment message for user ${fromId}:`, error.message);
                }
            }, 300000); // 5 minutes in milliseconds

        } catch (error) {
            console.error("Error generating unique amount or creating pending payment:", error);
            await bot.sendMessage(fromId, "Sorry, something went wrong while generating your payment link. Please try again.");
            await bot.answerCallbackQuery(cbq.id, { text: "Error. Please try again.", show_alert: true });
        }
    }
}

module.exports = {
    initializeSubscriberFlow,
    handleSubscriberMessage,
    handleSubscriberCallback
};
