// --- START OF bot/subscriberFlow.js ---

const ManagedChannel = require('../models/managedChannel.model');
const PendingPayment = require('../models/pendingPayment.model');
const { RENDER_EXTERNAL_URL, SUPER_ADMIN_ID } = process.env;

let botInstance;
let userStatesRef;

// We need to get the main escape function from server.js
function escapeMarkdownV2(text) {
    if (typeof text !== 'string') text = String(text);
    const escapeChars = '_*[]()~`>#+-=|{}.!';
    return text.replace(new RegExp(`[${escapeChars.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}]`, 'g'), '\\$&');
}


function initializeSubscriberFlow(bot, userStates) {
    botInstance = bot;
    userStatesRef = userStates;
}

async function handleSubscriberMessage(bot, msg) {
    const fromId = msg.from.id.toString();
    const text = msg.text || "";

    if (text.startsWith('/start ')) {
        const uniqueKey = text.split(' ')[1];
        const channel = await ManagedChannel.findOne({ unique_start_key: uniqueKey }).populate('owner_id');

        if (!channel) {
            return bot.sendMessage(fromId, "This link seems to be invalid or expired\\. Please contact the channel owner for a new link\\.", { parse_mode: 'MarkdownV2' });
        }

        userStatesRef[fromId] = {
            channel_id: channel.channel_id,
            channel_id_mongoose: channel._id,
            owner_id: channel.owner_id._id,
        };

        const safeChannelName = escapeMarkdownV2(channel.channel_name);
        const welcomeMessage = `Welcome to *${safeChannelName}*\\!\n\nPlease select a subscription plan:`;
        
        const planButtons = channel.plans.map(plan => ([{
            text: `${plan.days} Days for ₹${plan.price}`,
            callback_data: `sub_plan_${plan.days}_${plan.price}`
        }]));

        await bot.sendMessage(fromId, welcomeMessage, {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: planButtons
            }
        });
        return;
    }

    // Default message if user types something other than /start
    const defaultMessage = "Please use the special link provided by the channel owner to start the subscription process\\.";
    await bot.sendMessage(fromId, defaultMessage, { parse_mode: 'MarkdownV2' });
}

async function handleSubscriberCallback(bot, callbackQuery) {
    const fromId = callbackQuery.from.id.toString();
    const data = callbackQuery.data;

    if (data.startsWith('sub_plan_')) {
        await bot.answerCallbackQuery(callbackQuery.id);
        const parts = data.split('_');
        const days = parseInt(parts[2], 10);
        const price = parseFloat(parts[3]);

        const state = userStatesRef[fromId];
        if (!state) {
            return bot.sendMessage(fromId, "Something went wrong, your session has expired\\. Please use the start link again\\.", { parse_mode: 'MarkdownV2' });
        }

        try {
            const uniqueAmount = await global.generateAndVerifyUniqueAmount(price);
            
            const formattedAmount = uniqueAmount.toFixed(2);

            await PendingPayment.create({
                subscriber_id: fromId,
                owner_id: state.owner_id,
                channel_id: state.channel_id,
                channel_id_mongoose: state.channel_id_mongoose,
                plan_days: days,
                plan_price: price,
                unique_amount: uniqueAmount,
            });

            // Send notification to admin
            const channel = await ManagedChannel.findById(state.channel_id_mongoose);
            // Using simple Markdown here, it's safer for simple messages.
            const adminNotification = `🔔 New Payment Link Generated:\nUser: \`${fromId}\`\nAmount: \`₹${formattedAmount}\`\nChannel: ${channel.channel_name}`;
            await bot.sendMessage(SUPER_ADMIN_ID, adminNotification, { parse_mode: 'Markdown' });

            const paymentMessage = `Great\\! To get the *${days} Days Plan*, please pay exactly *₹${escapeMarkdownV2(formattedAmount)}* using the link below\\.\n\n*This link will expire in 5 minutes\\.*`;
            
            const paymentUrl = `${RENDER_EXTERNAL_URL}/?amount=${formattedAmount}`;
            
            await bot.sendMessage(fromId, paymentMessage, {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [[{
                        text: `Pay ₹${formattedAmount} Now`, // Plain text, no escaping needed here
                        url: paymentUrl
                    }]]
                }
            });

        } catch (error) {
            console.error("Error generating payment link:", error);
            await bot.sendMessage(fromId, "Sorry, we couldn't generate a payment link right now\\. Please try again in a moment\\.", { parse_mode: 'MarkdownV2' });
        }
    }
}

module.exports = {
    initializeSubscriberFlow,
    handleSubscriberMessage,
    handleSubscriberCallback
};

// --- END OF bot/subscriberFlow.js ---
