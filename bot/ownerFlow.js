const Owner = require('../models/owner.model');
const ManagedChannel = require('../models/managedChannel.model');
const Withdrawal = require('../models/withdrawal.model');
const { nanoid } = require('nanoid');

const userStates = {}; // Simple in-memory state management

async function handleOwnerMessage(bot, msg) {
    const chatId = msg.chat.id;
    const fromId = msg.from.id.toString();
    const text = msg.text;

    let owner = await Owner.findOne({ telegram_id: fromId });
    if (!owner) {
        owner = await Owner.create({ telegram_id: fromId, first_name: msg.from.first_name, username: msg.from.username });
    }

    const state = userStates[fromId];

    if (state && state.awaiting) {
        // Handle multi-step conversations
        if (state.awaiting === 'channel_forward') {
            await handleChannelForward(bot, msg, owner);
        } else if (state.awaiting === 'plans') {
            await handlePlansInput(bot, msg, owner);
        } else if (state.awaiting === 'upi_id') {
            await handleUpiInput(bot, msg, owner);
        } else if (state.awaiting === 'edit_plans') {
            await handlePlansInput(bot, msg, owner, true);
        }
        return;
    }

    // Handle initial commands
    switch (text) {
        case '/start':
            await showMainMenu(bot, chatId);
            break;
        case '/addchannel':
            await startAddChannelFlow(bot, chatId, fromId);
            break;
        case '/dashboard':
            await showDashboard(bot, chatId, owner);
            break;
        case '/withdraw':
            await startWithdrawalFlow(bot, chatId, owner);
            break;
        case '/mychannels':
            await listMyChannels(bot, chatId, owner);
            break;
        default:
            await showMainMenu(bot, chatId, `I didn't understand that command. Here are the options:`);
    }
}

async function handleOwnerCallback(bot, cbq) {
    const fromId = cbq.from.id.toString();
    const chatId = cbq.message.chat.id;
    const data = cbq.data;
    const owner = await Owner.findOne({ telegram_id: fromId });
    
    await bot.answerCallbackQuery(cbq.id);

    const parts = data.split('_');
    const action = parts[1];

    switch (action) {
        case 'mainmenu':
            await showMainMenu(bot, chatId, "Welcome Back!", cbq.message.message_id);
            break;
        case 'add':
            await startAddChannelFlow(bot, chatId, fromId);
            break;
        case 'dashboard':
            await showDashboard(bot, chatId, owner, cbq.message.message_id);
            break;
        case 'withdraw':
            await startWithdrawalFlow(bot, chatId, owner);
            break;
        case 'mychannels':
            await listMyChannels(bot, chatId, owner, cbq.message.message_id);
            break;
        case 'managechannel':
            await showChannelManagementMenu(bot, chatId, parts[2], cbq.message.message_id);
            break;
        case 'getlink':
            await sendChannelLink(bot, chatId, parts[2]);
            break;
        case 'editplans':
            userStates[fromId] = { awaiting: 'edit_plans', channel_db_id: parts[2] };
            await bot.sendMessage(chatId, `Okay, let's edit the plans for this channel.\n\nPlease send the new plans in the same format as before:\n\n\`30 days 100 rs\`\n\`90 days 250 rs\``, { parse_mode: 'Markdown' });
            break;
        case 'removechannel':
            await confirmRemoveChannel(bot, chatId, parts[2], cbq.message.message_id);
            break;
        case 'confirmremove':
            await removeChannel(bot, chatId, parts[2], cbq.message.message_id);
            break;
        case 'withdrawconfirm':
            await handleWithdrawConfirm(bot, cbq, owner);
            break;
        case 'withdrawcancel':
            delete userStates[fromId];
            await bot.editMessageText("Withdrawal request has been cancelled.", { chat_id: chatId, message_id: cbq.message.message_id });
            break;
    }
}

// --- FLOW HANDLERS ---
async function handleChannelForward(bot, msg, owner) {
    const fromId = owner.telegram_id;
    if (msg.forward_from_chat) {
        const channelId = msg.forward_from_chat.id.toString();
        const channelName = msg.forward_from_chat.title;
        try {
            const botMember = await bot.getChatMember(channelId, (await bot.getMe()).id);
            if (botMember.status !== 'administrator') {
                await bot.sendMessage(fromId, `❌ Bot is not an admin in "${channelName}". Please make the bot an admin and try again.`);
                delete userStates[fromId]; return;
            }
            userStates[fromId] = { awaiting: 'plans', channel_id: channelId, channel_name: channelName };
            await bot.sendMessage(fromId, `✅ Great! Bot is an admin in "${channelName}".\n\nNow, send subscription plans in this format:\n\n\`30 days 100 rs\`\n\`90 days 250 rs\``, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(fromId, `❌ An error occurred. Please make sure the bot is an admin in your channel and try again.`);
            delete userStates[fromId];
        }
    } else {
        await bot.sendMessage(fromId, `That was not a forwarded message. Please forward a message from your channel.`);
    }
}

async function handlePlansInput(bot, msg, owner, isEdit = false) {
    const fromId = owner.telegram_id;
    const state = userStates[fromId];
    const lines = msg.text.split('\n');
    const plans = [];
    let parseError = false;
    for (const line of lines) {
        const parts = line.match(/(\d+)\s+days?\s+(\d+)\s+rs?/i);
        if (parts) { plans.push({ days: parseInt(parts[1]), price: parseInt(parts[2]) }); } 
        else if (line.trim() !== '') { parseError = true; break; }
    }
    if (parseError || plans.length === 0) {
        await bot.sendMessage(fromId, `❌ Invalid format. Please use the format like: \`30 days 100 rs\`. Try again.`);
    } else {
        if (isEdit) {
            await ManagedChannel.findByIdAndUpdate(state.channel_db_id, { plans: plans });
            await bot.sendMessage(fromId, `✅ Plans updated successfully!`);
        } else {
            const uniqueKey = nanoid(8);
            await ManagedChannel.create({ owner_id: owner._id, channel_id: state.channel_id, channel_name: state.channel_name, unique_start_key: uniqueKey, plans: plans });
            const link = `https://t.me/${(await bot.getMe()).username}?start=${uniqueKey}`;
            await bot.sendMessage(fromId, `✅ Channel Added Successfully!\n\nShare this link with your users:\n\n\`${link}\``, { parse_mode: 'Markdown' });
        }
        delete userStates[fromId];
    }
}

async function handleUpiInput(bot, msg, owner) {
    const fromId = owner.telegram_id;
    const upiId = msg.text.trim();
    const amountToWithdraw = owner.wallet_balance;
    userStates[fromId] = { awaiting: 'withdraw_confirm', upi_id: upiId, amount: amountToWithdraw };
    const confirmationKeyboard = { inline_keyboard: [[{ text: "✅ Yes, Confirm", callback_data: "owner_withdrawconfirm" }, { text: "❌ No, Cancel", callback_data: "owner_withdrawcancel" }]] };
    await bot.sendMessage(fromId, `Please confirm:\n\nYou want to withdraw **₹${amountToWithdraw.toFixed(2)}** to **${upiId}**?`, { parse_mode: 'Markdown', reply_markup: confirmationKeyboard });
}

async function handleWithdrawConfirm(bot, cbq, owner) {
    const state = userStates[owner.telegram_id];
    if (state && state.awaiting === 'withdraw_confirm') {
        await Withdrawal.create({ owner_id: owner._id, amount: state.amount, upi_id: state.upi_id });
        await Owner.findByIdAndUpdate(owner._id, { $inc: { wallet_balance: -state.amount } });
        await bot.editMessageText(`✅ Your withdrawal request for **₹${state.amount.toFixed(2)}** has been submitted. It will be processed within 24 hours.`, { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id, parse_mode: 'Markdown' });
        await bot.sendMessage(process.env.SUPER_ADMIN_ID, `🔔 **New Withdrawal Request!**\n\nOwner: ${owner.first_name} (\`${owner.telegram_id}\`)\nAmount: \`₹${state.amount.toFixed(2)}\`\nUPI ID: \`${state.upi_id}\``, { parse_mode: 'Markdown' });
        delete userStates[owner.telegram_id];
    }
}

// --- UI & MENU FUNCTIONS ---
async function showMainMenu(bot, chatId, text = "Welcome, Channel Owner! What would you like to do?", messageId = null) {
    const keyboard = { inline_keyboard: [
        [{ text: "📊 My Dashboard", callback_data: "owner_dashboard" }, { text: "➕ Add a New Channel", callback_data: "owner_add" }],
        [{ text: "📺 My Channels", callback_data: "owner_mychannels" }]
    ]};
    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard });
    } else {
        await bot.sendMessage(chatId, text, { reply_markup: keyboard });
    }
}

async function startAddChannelFlow(bot, chatId, fromId) {
    userStates[fromId] = { awaiting: 'channel_forward' };
    await bot.sendMessage(chatId, `Okay, let's add a new channel.\n\n*Step 1:* Make this bot an Admin in your channel.\n\n*Step 2:* Now, **forward any message** from that channel here.`, { parse_mode: "Markdown" });
}

// --- THIS IS THE FIX ---
async function showDashboard(bot, chatId, owner, messageId = null) {
    const commission_percent = parseFloat(process.env.PLATFORM_COMMISSION_PERCENT);
    const totalEarnings = owner.total_earnings || 0;
    const service_charge_amount = (totalEarnings * commission_percent) / 100;
    const walletBalance = owner.wallet_balance || 0;

    const text = `
*📊 Your Dashboard*

📈 Total Revenue: *₹${totalEarnings.toFixed(2)}*
_(Total sales generated)_

➖ Service Charge (${commission_percent}%): *- ₹${service_charge_amount.toFixed(2)}*
_(Our platform fee for providing this service)_

💰 **Net Balance (Withdrawable):** **₹${walletBalance.toFixed(2)}**
`;

    const keyboard = { inline_keyboard: [
        [{ text: "💸 Request Withdrawal", callback_data: "owner_withdraw" }],
        [{ text: "⬅️ Back to Main Menu", callback_data: "owner_mainmenu" }]
    ]};

    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
    } else {
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
}
// --- END OF FIX ---

async function startWithdrawalFlow(bot, chatId, owner) {
    const minWithdrawal = parseFloat(process.env.MINIMUM_WITHDRAWAL_AMOUNT);
    if (owner.wallet_balance < minWithdrawal) {
        await bot.sendMessage(chatId, `❌ Sorry, you need at least ₹${minWithdrawal.toFixed(2)} to request a withdrawal. Your current balance is ₹${owner.wallet_balance.toFixed(2)}.`);
        return;
    }
    userStates[owner.telegram_id] = { awaiting: 'upi_id' };
    await bot.sendMessage(chatId, `Your current withdrawable balance is ₹${owner.wallet_balance.toFixed(2)}.\n\nPlease enter your UPI ID:`);
}

async function listMyChannels(bot, chatId, owner, messageId = null) {
    const channels = await ManagedChannel.find({ owner_id: owner._id });
    let text = "*Your Connected Channels:*\n\n";
    const keyboardRows = [];
    if (channels.length === 0) {
        text = "You haven't connected any channels yet.";
    } else {
        channels.forEach(ch => {
            keyboardRows.push([{ text: ch.channel_name, callback_data: `none` }, { text: "⚙️ Manage", callback_data: `owner_managechannel_${ch._id}` }]);
        });
    }
    keyboardRows.push([{ text: "⬅️ Back to Main Menu", callback_data: "owner_mainmenu" }]);
    if (messageId) {
        await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboardRows } });
    } else {
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboardRows } });
    }
}

async function showChannelManagementMenu(bot, chatId, channelDbId, messageId) {
    const channel = await ManagedChannel.findById(channelDbId);
    if (!channel) {
        await bot.editMessageText("Sorry, this channel was not found.", { chat_id: chatId, message_id: messageId });
        return;
    }
    const text = `Managing channel: *${channel.channel_name}*`;
    const keyboard = { inline_keyboard: [
        [{ text: "✏️ Edit Plans", callback_data: `owner_editplans_${channelDbId}` }, { text: "🔗 Get Link", callback_data: `owner_getlink_${channelDbId}` }],
        [{ text: "🗑️ Remove Channel", callback_data: `owner_removechannel_${channelDbId}` }],
        [{ text: "⬅️ Back to My Channels", callback_data: "owner_mychannels" }]
    ]};
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
}

async function sendChannelLink(bot, chatId, channelDbId) {
    const channel = await ManagedChannel.findById(channelDbId);
    const link = `https://t.me/${(await bot.getMe()).username}?start=${channel.unique_start_key}`;
    await bot.sendMessage(chatId, `Here is the subscriber link for *${channel.channel_name}*:\n\n\`${link}\``, { parse_mode: 'Markdown' });
}

async function confirmRemoveChannel(bot, chatId, channelDbId, messageId) {
    const text = "⚠️ **Are you sure?**\n\nRemoving this channel will stop new subscriptions, but existing subscribers will remain active until their plan expires. This action cannot be undone.";
    const keyboard = { inline_keyboard: [
        [{ text: "🗑️ Yes, Remove It", callback_data: `owner_confirmremove_${channelDbId}` }],
        [{ text: "⬅️ No, Go Back", callback_data: `owner_managechannel_${channelDbId}` }]
    ]};
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
}

async function removeChannel(bot, chatId, channelDbId, messageId) {
    await ManagedChannel.findByIdAndDelete(channelDbId);
    await bot.editMessageText("✅ Channel has been successfully removed from the platform.", { chat_id: chatId, message_id: messageId });
}

module.exports = { handleOwnerMessage, handleOwnerCallback };
