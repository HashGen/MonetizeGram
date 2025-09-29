const Owner = require('../models/owner.model');
const ManagedChannel = require('../models/managedChannel.model');
const { nanoid } = require('nanoid'); // You need to install this: npm install nanoid

const userStates = {}; // Simple in-memory state management

async function handleOwnerMessage(bot, msg) {
    const chatId = msg.chat.id;
    const fromId = msg.from.id.toString();
    const text = msg.text;

    // Register as a new owner
    let owner = await Owner.findOne({ telegram_id: fromId });
    if (!owner) {
        owner = await Owner.create({ 
            telegram_id: fromId, 
            first_name: msg.from.first_name,
            username: msg.from.username
        });
    }

    const state = userStates[fromId];

    // Handle multi-step conversations
    if (state) {
        if (state.awaiting === 'channel_forward') {
            if (msg.forward_from_chat) {
                const channelId = msg.forward_from_chat.id.toString();
                try {
                    const chatMember = await bot.getChatMember(channelId, bot.botId);
                    if (chatMember.status === 'administrator') {
                        userStates[fromId] = { awaiting: 'plans', channel_id: channelId, channel_name: msg.forward_from_chat.title };
                        await bot.sendMessage(chatId, `✅ Great! Bot is admin in "${msg.forward_from_chat.title}".\n\nNow, send your subscription plans in this format:\n\n\`30 days 100 rs\`\n\`90 days 250 rs\`\n\`365 days 800 rs\`\n\n(Each plan on a new line)`, { parse_mode: 'Markdown' });
                    } else {
                        await bot.sendMessage(chatId, `❌ Bot is not an admin in that channel. Please make the bot an admin and forward a message again.`);
                    }
                } catch (err) {
                     await bot.sendMessage(chatId, `❌ Could not verify bot's admin status. Please ensure the channel is public or the bot is a member and forward again.`);
                }
            } else {
                await bot.sendMessage(chatId, `Please just forward a message from your channel.`);
            }
            return;
        }

        if (state.awaiting === 'plans') {
            const lines = text.split('\n');
            const plans = [];
            let error = false;
            for (const line of lines) {
                const parts = line.match(/(\d+)\s+days?\s+(\d+)\s+rs?/i);
                if (parts) {
                    plans.push({ days: parseInt(parts[1]), price: parseInt(parts[2]) });
                } else {
                    error = true;
                    break;
                }
            }
            if (error || plans.length === 0) {
                 await bot.sendMessage(chatId, `❌ Invalid format. Please use the format like: \`30 days 100 rs\`. Try again.`);
            } else {
                const uniqueKey = nanoid(8); // Generate a unique key for the link
                await ManagedChannel.create({
                    owner_id: owner._id,
                    channel_id: state.channel_id,
                    channel_name: state.channel_name,
                    unique_start_key: uniqueKey,
                    plans: plans
                });
                const link = `https://t.me/${(await bot.getMe()).username}?start=${uniqueKey}`;
                await bot.sendMessage(chatId, `✅ Channel Added Successfully!\n\nShare this link with your users to let them subscribe:\n\n\`${link}\``, { parse_mode: 'Markdown' });
                delete userStates[fromId]; // End of conversation
            }
            return;
        }
    }

    // Handle commands
    if (text === '/start') {
        const keyboard = {
            inline_keyboard: [
                [{ text: "➕ Add a New Channel", callback_data: "owner_add_channel" }],
                [{ text: "📊 My Dashboard", callback_data: "owner_dashboard" }]
            ]
        };
        await bot.sendMessage(chatId, `Welcome, Channel Owner! What would you like to do?`, { reply_markup: keyboard });
    }
    
    if (text === '/addchannel') {
        userStates[fromId] = { awaiting: 'channel_forward' };
        await bot.sendMessage(chatId, `Okay, let's add a new channel.\n\n1. Add this bot to your premium channel as an Admin.\n2. Forward any message from that channel here.`);
    }

    if (text === '/dashboard') {
        await bot.sendMessage(chatId, `Your current wallet balance is: ₹${owner.wallet_balance.toFixed(2)}`);
    }
}

async function handleOwnerCallback(bot, cbq) {
    const fromId = cbq.from.id.toString();
    const data = cbq.data;

    if (data === 'owner_add_channel') {
        userStates[fromId] = { awaiting: 'channel_forward' };
        await bot.sendMessage(fromId, `Okay, let's add a new channel.\n\n1. Add this bot to your premium channel as an Admin.\n2. Forward any message from that channel here.`);
        await bot.answerCallbackQuery(cbq.id);
    }
    
     if (data === 'owner_dashboard') {
        const owner = await Owner.findOne({ telegram_id: fromId });
        await bot.sendMessage(fromId, `Your current wallet balance is: ₹${owner.wallet_balance.toFixed(2)}`);
        await bot.answerCallbackQuery(cbq.id, { text: `Balance: ₹${owner.wallet_balance.toFixed(2)}`});
    }
}

module.exports = { handleOwnerMessage, handleOwnerCallback };
