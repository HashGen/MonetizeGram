const Owner = require('../models/owner.model');
const ManagedChannel = require('../models/managedChannel.model');
const Withdrawal = require('../models/withdrawal.model');
const Transaction = require('../models/transaction.model');
const { nanoid } = require('nanoid');

// This object will be passed from server.js to store user's current action
let userStates;

// --- MULTI-LANGUAGE HELP TEXTS (WITH FULL DETAILS) ---
const LANGUAGES = {
    en: {
        HELP_TEXTS: {
            main: "Welcome to the Help Center! I am here to guide you. Please choose a topic below to learn more.",
            gettingStarted: `*🚀 Getting Started: How to Add Your Channel*

This is a simple 3-step process to connect your channel to our platform and start earning.

1️⃣  **Start the Process**
   - Use the \`/addchannel\` command or go to the main menu (\`/start\`) and click "➕ Add a New Channel".

2️⃣  **Give Admin Permissions**
   - The bot will ask you to make it an **Admin** in your premium channel.
   - Go to your channel's settings -> Administrators -> Add Admin, and add the bot. Please give it permission to "Invite Users via Link".

3️⃣  **Forward a Message**
   - Once the bot is an admin, **forward any message** from that channel to the bot. This is how the bot confirms it has access.

4️⃣  **Set Your Prices**
   - Finally, the bot will ask you to set your subscription prices. You need to send them in a specific format, with each plan on a new line.
   - *Example:*
     \`30 days 100 rs\`
     \`90 days 250 rs\`
     \`365 days 800 rs\`

✅ That's it! The bot will confirm and give you a unique link (e.g., \`t.me/YourBotName?start=AbCd123\`). Share this link with your users!`,
            
            dashboard: `*📊 Understanding Your Financial Dashboard*

Your dashboard (\`/dashboard\`) is your complete financial overview. Here's what each term means:

📈 *Total Revenue:*
   - This is the total gross amount of money generated from all sales on your channels, *before* any deductions.

➖ *Service Charge (${process.env.PLATFORM_COMMISSION_PERCENT}%):*
   - This is our platform fee for providing the bot, payment system, security, and support. It is automatically calculated based on your Total Revenue.

💰 *Gross Earnings:*
   - This is your total earning *after* the service charge is deducted from the Total Revenue.
   - The calculation is: \`(Total Revenue - Service Charge)\`.

💸 *Total Paid Out:*
   - This is the total amount of money you have successfully withdrawn to your bank account so far.

✅ **Net Balance (Withdrawable):**
   - This is the most important number. This is the actual money currently in your wallet that is ready to be withdrawn.
   - The calculation is: \`(Gross Earnings - Total Paid Out)\`.`,
            
            managingChannels: `*📺 Managing Your Channels*

You have full control over your connected channels.

- Use the \`/mychannels\` command to see a list of all channels you've connected.
- For each channel, you'll see a "⚙️ Manage" button. Clicking it gives you these powerful options:

✏️ *Edit Plans:*
   - Allows you to change the price or duration of your subscription plans at any time.

🔗 *Get Link:*
   - If you ever lose the special subscriber link for a channel, use this button to get it again.

🗑️ *Remove Channel:*
   - This will permanently delete the channel from our platform.
   - **Important:** New subscriptions will stop immediately. However, your existing subscribers will remain in the channel until their plan expires. This action cannot be undone.`,
            
            withdrawals: `*💸 The Withdrawal Process*

You can request a withdrawal of your earnings anytime your "Net Balance" is above the minimum limit (₹${process.env.MINIMUM_WITHDRAWAL_AMOUNT}).

1️⃣  **Start the Request**
   - Use the \`/withdraw\` command or go to your dashboard and click "💸 Request Withdrawal".

2️⃣  **Provide UPI ID**
   - The bot will ask for the UPI ID where you want to receive the money (e.g., \`yourname@oksbi\`). Please enter it carefully.

3️⃣  **Final Confirmation**
   - The bot will show you the exact amount to be withdrawn and your UPI ID, and ask for a final confirmation.

4️⃣  **Processing**
   - Once you confirm, your request is sent to the admin. The amount is immediately deducted from your wallet and marked as "pending".
   - The admin will manually process the payment to your UPI ID and approve the request in the system. This usually takes up to 24 hours.

You can check the status of all your past and pending requests in your dashboard under "💸 Withdrawal History".`
        }
    },
    hi: {
        HELP_TEXTS: {
            main: "सहायता केंद्र में आपका स्वागत है! मैं आपकी मदद करने के लिए यहाँ हूँ। कृपया नीचे एक विषय चुनें।",
            gettingStarted: `*🚀 शुरुआत करें: अपना चैनल कैसे जोड़ें*\n\nअपने चैनल को हमारे प्लेटफॉर्म से जोड़ने और कमाई शुरू करने के लिए यह एक सरल 3-चरणीय प्रक्रिया है।

1️⃣  **प्रक्रिया शुरू करें**
   - \`/addchannel\` कमांड का उपयोग करें या मुख्य मेनू (\`/start\`) पर जाएं और "➕ नया चैनल जोड़ें" पर क्लिक करें।

2️⃣  **एडमिन अनुमतियां दें**
   - बॉट आपसे इसे अपने प्रीमियम चैनल में **एडमिन** बनाने के लिए कहेगा।
   - अपने चैनल की सेटिंग्स -> एडमिनिस्ट्रेटर -> एडमिन जोड़ें पर जाएं, और बॉट को जोड़ें। कृपया इसे "लिंक के माध्यम से उपयोगकर्ताओं को आमंत्रित करें" की अनुमति दें।

3️⃣  **एक संदेश फॉरवर्ड करें**
   - एक बार जब बॉट एडमिन बन जाए, तो उस चैनल से **कोई भी संदेश** बॉट को फॉरवर्ड करें। इसी तरह बॉट पुष्टि करता है कि उसके पास एक्सेस है।

4️⃣  **अपनी कीमतें निर्धारित करें**
   - अंत में, बॉट आपसे अपनी सदस्यता की कीमतें निर्धारित करने के लिए कहेगा। आपको उन्हें एक विशिष्ट प्रारूप में भेजना होगा, प्रत्येक योजना एक नई लाइन पर।
   - *उदाहरण:*
     \`30 दिन 100 रुपये\`
     \`90 दिन 250 रुपये\`
     \`365 दिन 800 रुपये\`

✅ बस! बॉट पुष्टि करेगा और आपको अपने उपयोगकर्ताओं के साथ साझा करने के लिए एक यूनिक लिंक (जैसे, \`t.me/YourBotName?start=AbCd123\`) देगा।`,
            
            dashboard: `*📊 अपने वित्तीय डैशबोर्ड को समझें*\n\nआपका डैशबोर्ड (\`/dashboard\`) आपका संपूर्ण वित्तीय अवलोकन है। यहाँ प्रत्येक शब्द का अर्थ है:

📈 *कुल राजस्व:*
   - यह आपके चैनलों पर सभी बिक्री से उत्पन्न कुल सकल राशि है, किसी भी कटौती से *पहले*।

➖ *सेवा शुल्क (${process.env.PLATFORM_COMMISSION_PERCENT}%):*
   - यह बॉट, भुगतान प्रणाली, सुरक्षा और सहायता प्रदान करने के लिए हमारा प्लेटफ़ॉर्म शुल्क है। इसकी गणना स्वचालित रूप से आपके कुल राजस्व के आधार पर की जाती है।

💰 *सकल कमाई:*
   - यह कुल राजस्व से सेवा शुल्क घटाए जाने के *बाद* आपकी कुल कमाई है।
   - गणना है: \`(कुल राजस्व - सेवा शुल्क)\`।

💸 *कुल भुगतान:*
   - यह वह कुल राशि है जिसे आपने अब तक सफलतापूर्वक अपने बैंक खाते में निकाला है।

✅ **नेट बैलेंस (निकासी योग्य):**
   - यह सबसे महत्वपूर्ण संख्या है। यह वर्तमान में आपके वॉलेट में वास्तविक धन है जो निकालने के लिए तैयार है।
   - गणना है: \`(सकल कमाई - कुल भुगतान)\`।`,
            
            managingChannels: `*📺 अपने चैनलों का प्रबंधन*

आपके जुड़े हुए चैनलों पर आपका पूरा नियंत्रण है।

- अपने सभी जुड़े हुए चैनलों की सूची देखने के लिए \`/mychannels\` कमांड का उपयोग करें।
- प्रत्येक चैनल के लिए, आपको एक "⚙️ प्रबंधित करें" बटन दिखाई देगा। इस पर क्लिक करने से आपको ये शक्तिशाली विकल्प मिलते हैं:

✏️ *प्लान संपादित करें:*
   - आपको किसी भी समय अपनी सदस्यता योजनाओं की कीमत या अवधि बदलने की अनुमति देता है।

🔗 *लिंक प्राप्त करें:*
   - यदि आप कभी किसी चैनल के लिए विशेष सब्सक्राइबर लिंक खो देते हैं, तो इसे फिर से प्राप्त करने के लिए इस बटन का उपयोग करें।

🗑️ *चैनल हटाएं:*
   - यह चैनल को हमारे प्लेटफ़ॉर्म से स्थायी रूप से हटा देगा।
   - **महत्वपूर्ण:** नई सदस्यताएँ तुरंत बंद हो जाएंगी। हालाँकि, आपके मौजूदा ग्राहक अपनी योजना समाप्त होने तक चैनल में बने रहेंगे। यह क्रिया पूर्ववत नहीं की जा सकती है।`,
            
            withdrawals: `*💸 निकासी प्रक्रिया*

जब भी आपका "नेट बैलेंस" न्यूनतम सीमा (₹${process.env.MINIMUM_WITHDRAWAL_AMOUNT}) से ऊपर हो, आप अपनी कमाई की निकासी का अनुरोध कर सकते हैं।

1️⃣  **अनुरोध शुरू करें**
   - \`/withdraw\` कमांड का उपयोग करें या अपने डैशबोर्ड पर जाएं और "💸 निकासी का अनुरोध करें" पर क्लिक करें।

2️⃣  **UPI ID प्रदान करें**
   - बॉट उस UPI ID के लिए पूछेगा जहां आप पैसा प्राप्त करना चाहते हैं (जैसे, \`yourname@oksbi\`)। कृपया इसे ध्यान से दर्ज करें।

3️⃣  **अंतिम पुष्टि**
   - बॉट आपको निकाली जाने वाली सटीक राशि और आपकी UPI ID दिखाएगा, और अंतिम पुष्टि के लिए पूछेगा।

4️⃣  **प्रसंस्करण**
   - एक बार जब आप पुष्टि कर देते हैं, तो आपका अनुरोध एडमिन को भेज दिया जाता है। राशि तुरंत आपके वॉलेट से काट ली जाती है और "लंबित" के रूप में चिह्नित हो जाती है।
   - एडमिन मैन्युअल रूप से आपकी UPI ID पर भुगतान की प्रक्रिया करेगा और सिस्टम में अनुरोध को मंजूरी देगा। इसमें आमतौर पर 24 घंटे तक लगते हैं।

आप अपने डैशबोर्ड में "💸 निकासी इतिहास" के तहत अपने सभी पिछले और लंबित अनुरोधों की स्थिति की जांच कर सकते हैं।`
        }
    }
};

async function handleOwnerMessage(bot, msg) {
    const fromId = msg.from.id.toString();
    const text = msg.text || "";
    let owner = await Owner.findOne({ telegram_id: fromId });
    if (!owner) {
        owner = await Owner.create({ telegram_id: fromId, first_name: msg.from.first_name, username: msg.from.username });
    }
    if (owner.is_banned) {
        return bot.sendMessage(fromId, `❌ Your account is currently banned. Please contact support: @${process.env.SUPER_ADMIN_USERNAME}`);
    }
    
    // --- THIS IS THE FIX ---
    // If user sends a command, always cancel any pending state
    if (text.startsWith('/')) {
        if (userStates[fromId]) {
            delete userStates[fromId];
            // Optional: send a message that the process was cancelled
            // await bot.sendMessage(fromId, "Previous action cancelled.");
        }
    }
    // --- END OF FIX ---

    const state = userStates[fromId];
    if (state && state.awaiting) {
        if (state.awaiting === 'upi_id') await handleUpiInput(bot, msg, owner);
        else if (state.awaiting === 'plans') await handlePlansInput(bot, msg, owner, state.isEdit);
        else if (state.awaiting === 'channel_forward') await handleChannelForward(bot, msg, owner);
        return;
    }
    switch (text) {
        case '/start': await showMainMenu(bot, msg.chat.id, owner); break;
        case '/addchannel': await startAddChannelFlow(bot, msg.chat.id, fromId); break;
        case '/dashboard': await showDashboard(bot, msg.chat.id, owner); break;
        case '/withdraw': await startWithdrawalFlow(bot, msg.chat.id, owner); break;
        case '/mychannels': await listMyChannels(bot, msg.chat.id, owner); break;
        case '/help': await showHelpMenu(bot, msg.chat.id, owner); break;
        default: 
            // If we are in a state, but the text is not a command, it's a wrong input
            if (state && state.awaiting) {
                 await bot.sendMessage(fromId, `I'm waiting for specific information. Please provide it or send /start to go back to the main menu.`);
            } else {
                await showMainMenu(bot, msg.chat.id, owner, `I didn't understand. Here are the options:`);
            }
    }
}

async function handleOwnerCallback(bot, cbq) {
    const fromId = cbq.from.id.toString();
    const chatId = cbq.message.chat.id;
    const messageId = cbq.message.message_id;
    const data = cbq.data;
    
    // --- THIS IS THE FIX ---
    // Clear any pending state when a button is clicked, as it starts a new flow
    delete userStates[fromId];
    
    let owner = await Owner.findOne({ telegram_id: fromId });
    if (!owner) {
        owner = await Owner.create({ telegram_id: fromId, first_name: cbq.from.first_name, username: cbq.from.username });
    }

    await bot.answerCallbackQuery(cbq.id);

    const parts = data.split('_');
    const command = parts[1];
    const objectId = parts[2];

    switch (command) {
        case 'mainmenu': await showMainMenu(bot, chatId, owner, "Welcome Back!", messageId); break;
        case 'add': await startAddChannelFlow(bot, chatId, fromId); break;
        case 'dashboard': await showDashboard(bot, chatId, owner, messageId); break;
        case 'withdraw': await startWithdrawalFlow(bot, chatId, owner); break;
        case 'mychannels': await listMyChannels(bot, chatId, owner, messageId); break;
        case 'help': await showHelpMenu(bot, chatId, owner, messageId); break;
        case 'setlang': 
            owner.language = objectId;
            await owner.save();
            await showHelpMenu(bot, chatId, owner, messageId); 
            break;
        case 'helpsection': 
            const lang = owner.language || 'en';
            await bot.editMessageText(LANGUAGES[lang].HELP_TEXTS[objectId], { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: "owner_help" }]] } }); 
            break;
        case 'transactions': await showTransactionHistory(bot, chatId, owner, messageId); break;
        case 'withdrawalhistory': await showWithdrawalHistory(bot, chatId, owner, messageId); break;
        case 'channelstats': await showChannelStats(bot, chatId, owner, messageId); break;
        case 'managechannel': await showChannelManagementMenu(bot, chatId, objectId, messageId); break;
        case 'getlink': await sendChannelLink(bot, chatId, objectId); break;
        case 'editplans': userStates[fromId] = { awaiting: 'edit_plans', channel_db_id: objectId, isEdit: true }; await bot.sendMessage(chatId, `Send new plans in the format:\n\`30 days 100 rs\`\n\n_(To cancel, send /start)_`, { parse_mode: 'Markdown' }); break;
        case 'removechannel': await confirmRemoveChannel(bot, chatId, objectId, messageId); break;
        case 'confirmremove': await removeChannel(bot, chatId, objectId, messageId); break;
        case 'withdrawconfirm': await handleWithdrawConfirm(bot, cbq, owner); break;
        case 'withdrawcancel': delete userStates[fromId]; await bot.editMessageText("Withdrawal request cancelled.", { chat_id: chatId, message_id: messageId }); break;
    }
}

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
            await bot.sendMessage(fromId, `✅ Great! Bot is an admin in "${channelName}".\n\nNow, send subscription plans in this format:\n\n\`30 days 100 rs\`\n\`90 days 250 rs\`\n\n_(To cancel, send /start)_`, { parse_mode: 'Markdown' });
        } catch (error) {
            await bot.sendMessage(fromId, `❌ An error occurred. Please make sure the bot is an admin in your channel and try again.`);
            delete userStates[fromId];
        }
    } else {
        await bot.sendMessage(fromId, `That was not a forwarded message. Please forward a message from your channel or send /start to cancel.`);
    }
};

async function startAddChannelFlow(bot, chatId, fromId) {
    userStates[fromId] = { awaiting: 'channel_forward' };
    await bot.sendMessage(chatId, `Okay, let's add a new channel.\n\n*Step 1:* Make this bot an Admin in your channel.\n\n*Step 2:* Now, **forward any message** from that channel here.\n\n_(To cancel this process at any time, just send /start)_`, { parse_mode: "Markdown" });
}
async function startWithdrawalFlow(bot, chatId, owner) {
    const minWithdrawal = parseFloat(process.env.MINIMUM_WITHDRAWAL_AMOUNT);
    if (owner.wallet_balance < minWithdrawal) {
        await bot.sendMessage(chatId, `❌ Sorry, you need at least ₹${minWithdrawal.toFixed(2)} to request a withdrawal. Your current balance is ₹${owner.wallet_balance.toFixed(2)}.`);
        return;
    }
    userStates[owner.telegram_id] = { awaiting: 'upi_id' };
    await bot.sendMessage(chatId, `Your current withdrawable balance is ₹${owner.wallet_balance.toFixed(2)}.\n\nPlease enter your UPI ID:\n\n_(To cancel, send /start)_`, {parse_mode: 'Markdown'});
}

// ... (Rest of the functions are unchanged, but provided below for completeness)
async function showMainMenu(bot, chatId, owner, text = "Welcome, Channel Owner!", messageId = null) { const keyboard = { inline_keyboard: [ [{ text: "📊 My Dashboard", callback_data: "owner_dashboard" }, { text: "➕ Add a New Channel", callback_data: "owner_add" }], [{ text: "📺 My Channels", callback_data: "owner_mychannels" }, { text: "❓ Help & Support", callback_data: "owner_help" }] ]}; if (messageId) await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: keyboard }); else await bot.sendMessage(chatId, text, { reply_markup: keyboard }); }
async function showHelpMenu(bot, chatId, owner, messageId = null) { const lang = owner.language || 'en'; const otherLang = lang === 'en' ? 'hi' : 'en'; const langText = lang === 'en' ? '🇮🇳 हिंदी में स्विच करें' : '🇬🇧 Switch to English'; const help = LANGUAGES[lang].HELP_TEXTS; const keyboard = { inline_keyboard: [ [{ text: "🚀 Getting Started", callback_data: "owner_helpsection_gettingStarted" }], [{ text: "📊 Understanding Dashboard", callback_data: "owner_helpsection_dashboard" }], [{ text: "📺 Managing Channels", callback_data: "owner_helpsection_managingChannels" }], [{ text: "💸 Withdrawal Process", callback_data: "owner_helpsection_withdrawals" }], [{ text: langText, callback_data: `owner_setlang_${otherLang}`}], [{ text: "⬅️ Back to Main Menu", callback_data: "owner_mainmenu" }] ]}; if(messageId) await bot.editMessageText(help.main, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }); else await bot.sendMessage(chatId, help.main, { parse_mode: 'Markdown', reply_markup: keyboard }); }
async function handlePlansInput(bot, msg, owner, isEdit = false) { const fromId = owner.telegram_id; const state = userStates[fromId]; const lines = msg.text.split('\n'); const plans = []; let parseError = false; for (const line of lines) { const parts = line.match(/(\d+)\s+days?\s+(\d+)\s+rs?/i); if (parts) { plans.push({ days: parseInt(parts[1]), price: parseInt(parts[2]) }); } else if (line.trim() !== '') { parseError = true; break; } } if (parseError || plans.length === 0) { await bot.sendMessage(fromId, `❌ Invalid format. Please use the format like: \`30 days 100 rs\`. Try again, or send /start to cancel.`); } else { if (isEdit) { await ManagedChannel.findByIdAndUpdate(state.channel_db_id, { plans: plans }); await bot.sendMessage(fromId, `✅ Plans updated successfully!`); } else { const uniqueKey = nanoid(8); await ManagedChannel.create({ owner_id: owner._id, channel_id: state.channel_id, channel_name: state.channel_name, unique_start_key: uniqueKey, plans: plans }); const link = `https://t.me/${(await bot.getMe()).username}?start=${uniqueKey}`; await bot.sendMessage(fromId, `✅ Channel Added Successfully!\n\nShare this link with your users:\n\n\`${link}\``, { parse_mode: 'Markdown' }); } delete userStates[fromId]; }};
async function handleUpiInput(bot, msg, owner) { const fromId = owner.telegram_id; const upiId = msg.text.trim(); const amountToWithdraw = owner.wallet_balance; userStates[fromId] = { awaiting: 'withdraw_confirm', upi_id: upiId, amount: amountToWithdraw }; const confirmationKeyboard = { inline_keyboard: [[{ text: "✅ Yes, Confirm", callback_data: "owner_withdrawconfirm" }, { text: "❌ No, Cancel", callback_data: "owner_withdrawcancel" }]] }; await bot.sendMessage(fromId, `Please confirm:\n\nYou want to withdraw **₹${amountToWithdraw.toFixed(2)}** to **${upiId}**?`, { parse_mode: 'Markdown', reply_markup: confirmationKeyboard }); };
async function handleWithdrawConfirm(bot, cbq, owner) { const state = userStates[owner.telegram_id]; if (state && state.awaiting === 'withdraw_confirm') { await Withdrawal.create({ owner_id: owner._id, amount: state.amount, upi_id: state.upi_id }); await Owner.findByIdAndUpdate(owner._id, { $inc: { wallet_balance: -state.amount } }); await bot.editMessageText(`✅ Your withdrawal request for **₹${state.amount.toFixed(2)}** has been submitted. It will be processed within 24 hours.`, { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id, parse_mode: 'Markdown' }); await bot.sendMessage(process.env.SUPER_ADMIN_ID, `🔔 **New Withdrawal Request!**\n\nOwner: ${owner.first_name} (\`${owner.telegram_id}\`)\nAmount: \`₹${state.amount.toFixed(2)}\`\nUPI ID: \`${state.upi_id}\``, { parse_mode: 'Markdown' }); delete userStates[owner.telegram_id]; }};
async function showDashboard(bot, chatId, owner, messageId = null) { const commission_percent = parseFloat(process.env.PLATFORM_COMMISSION_PERCENT); const totalEarnings = owner.total_earnings || 0; const service_charge_amount = (totalEarnings * commission_percent) / 100; const walletBalance = owner.wallet_balance || 0; const paidOutAggregation = await Withdrawal.aggregate([ { $match: { owner_id: owner._id, status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } } ]); const totalPaidOut = paidOutAggregation.length > 0 ? paidOutAggregation[0].total : 0; const grossEarnings = totalEarnings - service_charge_amount; const text = `*📊 Your Financial Dashboard*\n\n*Summary:*\n📈 Total Revenue: *₹${totalEarnings.toFixed(2)}*\n➖ Service Charge (${commission_percent}%): *- ₹${service_charge_amount.toFixed(2)}*\n------------------------------------\n💰 Gross Earnings: *₹${grossEarnings.toFixed(2)}*\n   _(${totalEarnings.toFixed(2)} - ${service_charge_amount.toFixed(2)})_\n\n*Payouts:*\n💸 Total Paid Out: *- ₹${totalPaidOut.toFixed(2)}*\n------------------------------------\n✅ **Net Balance (Withdrawable):** **₹${walletBalance.toFixed(2)}**`; const keyboard = { inline_keyboard: [ [{ text: "💸 Request Withdrawal", callback_data: "owner_withdraw" }], [{ text: "📜 Transaction History", callback_data: "owner_transactions" }, { text: "💸 Withdrawal History", callback_data: "owner_withdrawalhistory" }], [{ text: "📺 Channel Stats", callback_data: "owner_channelstats" }], [{ text: "⬅️ Back to Main Menu", callback_data: "owner_mainmenu" }] ]}; if (messageId) await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }); else await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard }); }
async function showTransactionHistory(bot, chatId, owner, messageId) { const transactions = await Transaction.find({ owner_id: owner._id }).sort({ timestamp: -1 }).limit(10); let text = "*📜 Last 10 Transactions:*\n\n"; if (transactions.length === 0) { text = "You have no transactions yet."; } else { transactions.forEach(t => { const date = new Date(t.timestamp).toLocaleDateString('en-IN'); text += `*Sale:* +₹${t.amount_paid.toFixed(2)} | *Fee:* -₹${t.commission_charged.toFixed(2)} | *Net:* +₹${t.amount_credited_to_owner.toFixed(2)} _(${date})_\n`; }); } const keyboard = { inline_keyboard: [[{ text: "⬅️ Back to Dashboard", callback_data: "owner_dashboard" }]] }; await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }); }
async function showWithdrawalHistory(bot, chatId, owner, messageId) { const withdrawals = await Withdrawal.find({ owner_id: owner._id }).sort({ requested_at: -1 }).limit(10); let text = "*💸 Last 10 Withdrawals:*\n\n"; if (withdrawals.length === 0) { text = "You have no withdrawal history."; } else { const status_emoji = { pending: '⌛️', approved: '✅', rejected: '❌' }; withdrawals.forEach(w => { const date = new Date(w.requested_at).toLocaleDateString('en-IN'); text += `${status_emoji[w.status]} *₹${w.amount.toFixed(2)}* to ${w.upi_id} _(${date})_ - *${w.status}*\n`; }); } const keyboard = { inline_keyboard: [[{ text: "⬅️ Back to Dashboard", callback_data: "owner_dashboard" }]] }; await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }); }
async function showChannelStats(bot, chatId, owner, messageId) { const stats = await Transaction.aggregate([ { $match: { owner_id: owner._id } }, { $group: { _id: '$channel_id', totalRevenue: { $sum: '$amount_paid' }, count: { $sum: 1 } } } ]); let text = "*📺 Channel-wise Earnings:*\n\n"; if (stats.length === 0) { text = "No sales data available for any channel yet."; } else { for (const stat of stats) { const channel = await ManagedChannel.findOne({ channel_id: stat._id }); const channelName = channel ? channel.channel_name : `Deleted Channel (${stat._id})`; text += `*${channelName}:*\n- Total Revenue: *₹${stat.totalRevenue.toFixed(2)}*\n- Total Sales: *${stat.count}*\n\n`; } } const keyboard = { inline_keyboard: [[{ text: "⬅️ Back to Dashboard", callback_data: "owner_dashboard" }]] }; await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }); }
async function listMyChannels(bot, chatId, owner, messageId = null) { const channels = await ManagedChannel.find({ owner_id: owner._id }); let text = "*Your Connected Channels:*\n\n"; const keyboardRows = []; if (channels.length === 0) { text = "You haven't connected any channels yet."; } else { channels.forEach(ch => { keyboardRows.push([{ text: ch.channel_name, callback_data: `none` }, { text: "⚙️ Manage", callback_data: `owner_managechannel_${ch._id}` }]); }); } keyboardRows.push([{ text: "⬅️ Back to Main Menu", callback_data: "owner_mainmenu" }]); const opts = { chat_id: chatId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboardRows } }; if(messageId) { opts.message_id = messageId; await bot.editMessageText(text, opts); } else { await bot.sendMessage(chatId, text, opts); } }
async function showChannelManagementMenu(bot, chatId, channelDbId, messageId) { const channel = await ManagedChannel.findById(channelDbId); if (!channel) { await bot.editMessageText("Sorry, this channel was not found.", { chat_id: chatId, message_id: messageId }); return; } const text = `Managing channel: *${channel.channel_name}*`; const keyboard = { inline_keyboard: [ [{ text: "✏️ Edit Plans", callback_data: `owner_editplans_${channelDbId}` }, { text: "🔗 Get Link", callback_data: `owner_getlink_${channelDbId}` }], [{ text: "🗑️ Remove Channel", callback_data: `owner_removechannel_${channelDbId}` }], [{ text: "⬅️ Back to My Channels", callback_data: "owner_mychannels" }] ]}; await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }); }
async function sendChannelLink(bot, chatId, channelDbId) { const channel = await ManagedChannel.findById(channelDbId); const link = `https://t.me/${(await bot.getMe()).username}?start=${channel.unique_start_key}`; await bot.sendMessage(chatId, `Here is the subscriber link for *${channel.channel_name}*:\n\n\`${link}\``, { parse_mode: 'Markdown' }); }
async function confirmRemoveChannel(bot, chatId, channelDbId, messageId) { const text = "⚠️ **Are you sure?**\n\nRemoving this channel will stop new subscriptions, but existing subscribers will remain active until their plan expires. This action cannot be undone."; const keyboard = { inline_keyboard: [ [{ text: "🗑️ Yes, Remove It", callback_data: `owner_confirmremove_${channelDbId}` }], [{ text: "⬅️ No, Go Back", callback_data: `owner_managechannel_${channelDbId}` }] ]}; await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }); }
async function removeChannel(bot, chatId, channelDbId, messageId) { await ManagedChannel.findByIdAndDelete(channelDbId); await bot.editMessageText("✅ Channel has been successfully removed from the platform.", { chat_id: chatId, message_id: messageId }); }

module.exports = { initializeOwnerFlow, handleOwnerMessage, handleOwnerCallback };
