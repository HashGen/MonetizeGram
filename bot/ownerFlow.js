const Owner = require('../models/owner.model');
const ManagedChannel = require('../models/managedChannel.model');
const Withdrawal = require('../models/withdrawal.model'); // Import the Withdrawal model
const { nanoid } = require('nanoid');

const userStates = {}; // Simple in-memory state management

async function handleOwnerMessage(bot, msg) {
    const chatId = msg.chat.id;
    const fromId = msg.from.id.toString();
    const text = msg.text;

    // Register as a new owner if not already
    let owner = await Owner.findOne({ telegram_id: fromId });
    if (!owner) {
        owner = await Owner.create({ 
            telegram_id: fromId, 
            first_name: msg.from.first_name,
            username: msg.from.username
        });
    }

    const state = userStates[fromId];

    // Handle multi-step conversations for withdrawal
    if (state && state.awaiting === 'upi_id') {
        const upiId = text.trim();
        const amountToWithdraw = owner.wallet_balance;

        userStates[fromId] = { awaiting: 'withdraw_confirm', upi_id: upiId, amount: amountToWithdraw };
        
        const confirmationKeyboard = {
            inline_keyboard: [[
                { text: "✅ Yes, Confirm", callback_data: "owner_withdraw_confirm" },
                { text: "❌ No, Cancel", callback_data: "owner_withdraw_cancel" }
            ]]
        };
        await bot.sendMessage(chatId, `Please confirm:\n\nYou want to withdraw **₹${amountToWithdraw.toFixed(2)}** to the UPI ID **${upiId}**?`, {
            parse_mode: 'Markdown',
            reply_markup: confirmationKeyboard
        });
        return;
    }

    // Handle channel setup conversations
    if (state && state.awaiting) {
        // ... (channel setup logic remains the same)
        if (state.awaiting === 'channel_forward') {
            if (msg.forward_from_chat) {
                const channelId = msg.forward_from_chat.id.toString();
                const channelName = msg.forward_from_chat.title;
                try {
                    const botMember = await bot.getChatMember(channelId, (await bot.getMe()).id);
                    if (botMember.status !== 'administrator') {
                        await bot.sendMessage(chatId, `❌ Bot is not an admin in "${channelName}". Please make the bot an admin and try again.`);
                        delete userStates[fromId]; return;
                    }
                    userStates[fromId] = { awaiting: 'plans', channel_id: channelId, channel_name: channelName };
                    await bot.sendMessage(chatId, `✅ Great! Bot is an admin in "${channelName}".\n\nNow, send your subscription plans in this format:\n\n\`30 days 100 rs\`\n\`90 days 250 rs\`\n\n(Each plan on a new line)`, { parse_mode: 'Markdown' });
                } catch (error) {
                    await bot.sendMessage(chatId, `❌ An error occurred. Please make sure the bot is an admin in your channel and try again.`);
                    delete userStates[fromId];
                }
            } else {
                await bot.sendMessage(chatId, `That was not a forwarded message. Please forward a message from your channel.`);
            }
            return;
        }
        if (state.awaiting === 'plans') {
            const lines = text.split('\n');
            const plans = [];
            let parseError = false;
            for (const line of lines) {
                const parts = line.match(/(\d+)\s+days?\s+(\d+)\s+rs?/i);
                if (parts) { plans.push({ days: parseInt(parts[1]), price: parseInt(parts[2]) }); } 
                else if (line.trim() !== '') { parseError = true; break; }
            }
            if (parseError || plans.length === 0) {
                 await bot.sendMessage(chatId, `❌ Invalid format. Please use the format like: \`30 days 100 rs\`. Try again.`);
            } else {
                const uniqueKey = nanoid(8);
                await ManagedChannel.create({ owner_id: owner._id, channel_id: state.channel_id, channel_name: state.channel_name, unique_start_key: uniqueKey, plans: plans });
                const link = `https://t.me/${(await bot.getMe()).username}?start=${uniqueKey}`;
                await bot.sendMessage(chatId, `✅ Channel Added Successfully!\n\nShare this link with your users to let them subscribe:\n\n\`${link}\``, { parse_mode: 'Markdown' });
                delete userStates[fromId];
            }
            return;
        }
    }

    // Handle initial commands
    if (text === '/start') {
        const keyboard = { inline_keyboard: [
            [{ text: "➕ Add a New Channel", callback_data: "owner_add_channel" }],
            [{ text: "📊 My Dashboard", callback_data: "owner_dashboard" }],
            [{ text: "💸 Request Withdrawal", callback_data: "owner_withdraw_start"}]
        ]};
        await bot.sendMessage(chatId, `Welcome, Channel Owner! What would you like to do?`, { reply_markup: keyboard });
    } else if (text === '/addchannel') {
        await startAddChannelFlow(bot, chatId, fromId);
    } else if (text === '/dashboard') {
        await showDashboard(bot, chatId, owner);
    } else if (text === '/withdraw') {
        await startWithdrawalFlow(bot, chatId, owner);
    }
}

async function handleOwnerCallback(bot, cbq) {
    const fromId = cbq.from.id.toString();
    const chatId = cbq.message.chat.id;
    const data = cbq.data;
    const owner = await Owner.findOne({ telegram_id: fromId });
    
    await bot.answerCallbackQuery(cbq.id);

    if (data === 'owner_add_channel') {
        await startAddChannelFlow(bot, chatId, fromId);
    } else if (data === 'owner_dashboard') {
        await showDashboard(bot, chatId, owner);
    } else if (data === 'owner_withdraw_start') {
        await startWithdrawalFlow(bot, chatId, owner);
    } else if (data === 'owner_withdraw_confirm') {
        const state = userStates[fromId];
        if (state && state.awaiting === 'withdraw_confirm') {
            await Withdrawal.create({
                owner_id: owner._id,
                amount: state.amount,
                upi_id: state.upi_id
            });
            await Owner.findByIdAndUpdate(owner._id, { $inc: { wallet_balance: -state.amount } });
            
            await bot.editMessageText(`✅ Your withdrawal request for **₹${state.amount.toFixed(2)}** has been submitted. It will be processed by the admin within 24 hours.`, { chat_id: chatId, message_id: cbq.message.message_id, parse_mode: 'Markdown' });
            
            // Notify Super Admin
            await bot.sendMessage(process.env.SUPER_ADMIN_ID, `🔔 **New Withdrawal Request!**\n\nOwner: ${owner.first_name} (\`${owner.telegram_id}\`)\nAmount: \`₹${state.amount.toFixed(2)}\`\nUPI ID: \`${state.upi_id}\``, { parse_mode: 'Markdown' });
            
            delete userStates[fromId];
        }
    } else if (data === 'owner_withdraw_cancel') {
        delete userStates[fromId];
        await bot.editMessageText("Withdrawal request has been cancelled.", { chat_id: chatId, message_id: cbq.message.message_id });
    }
}

async function startAddChannelFlow(bot, chatId, fromId) {
    userStates[fromId] = { awaiting: 'channel_forward' };
    await bot.sendMessage(chatId, `Okay, let's add a new channel.\n\n*Step 1:* Make sure this bot is an Admin in your channel.\n\n*Step 2:* Now, **forward any message** from that channel here.`, { parse_mode: "Markdown" });
}

async function showDashboard(bot, chatId, owner) {
    await bot.sendMessage(chatId, `*Your Dashboard*\n\n💰 Wallet Balance: ₹${owner.wallet_balance.toFixed(2)}\n📈 Total Earnings: ₹${owner.total_earnings.toFixed(2)}`, { parse_mode: 'Markdown' });
}

async function startWithdrawalFlow(bot, chatId, owner) {
    const minWithdrawal = parseFloat(process.env.MINIMUM_WITHDRAWAL_AMOUNT);
    if (owner.wallet_balance < minWithdrawal) {
        await bot.sendMessage(chatId, `❌ Sorry, you need at least ₹${minWithdrawal.toFixed(2)} in your wallet to request a withdrawal. Your current balance is ₹${owner.wallet_balance.toFixed(2)}.`);
        return;
    }
    userStates[owner.telegram_id] = { awaiting: 'upi_id' };
    await bot.sendMessage(chatId, `Your current withdrawable balance is ₹${owner.wallet_balance.toFixed(2)}.\n\nPlease enter the UPI ID where you want to receive the money.`);
}

module.exports = { handleOwnerMessage, handleOwnerCallback };
