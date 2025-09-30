const express = require('express');
const Owner = require('../models/owner.model');
const ManagedChannel = require('../models/managedChannel.model');
const Transaction = require('../models/transaction.model');
const Withdrawal = require('../models/withdrawal.model');
const Report = require('../models/report.model');

module.exports = function(bot) {
    const router = express.Router();

    const checkSuperAdmin = (req, res, next) => {
        const secret = req.query.secret;
        if (secret !== process.env.SUPER_ADMIN_SECRET) {
            return res.status(403).send('Forbidden: Invalid Super Admin Secret');
        }
        next();
    };

    router.use(checkSuperAdmin);
    
    // --- THIS IS THE FIX for "Failed to load reports" ---
    router.get('/reports', async (req, res) => {
        try {
            const reports = await Report.find({ status: 'pending' })
                .populate('reported_owner_id', 'first_name telegram_id')
                .populate('reported_channel_id', 'channel_name')
                .sort({ created_at: -1 });
            res.json(reports);
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch reports" });
        }
    });

    // --- NEW FEATURE: MARK REPORT AS RESOLVED ---
    router.post('/reports/:id/resolve', async (req, res) => {
        try {
            const report = await Report.findByIdAndUpdate(req.params.id, { status: 'resolved' });
            if (!report) {
                return res.status(404).send('Report not found.');
            }
            
            // Notify the user who reported the issue
            await bot.sendMessage(report.reporter_id, 
                `✅ **Your Issue has been Resolved**\n\nHello! The issue you reported regarding channel "${report.reported_channel_id.channel_name}" has been reviewed and resolved by the admin.\n\nThank you for helping us keep the platform safe.`
            ).catch(err => console.log(`Could not send resolved notification to ${report.reporter_id}`));

            res.json({ message: "Report marked as resolved and user notified." });

        } catch (error) {
            console.error("Error resolving report:", error);
            res.status(500).json({ error: "Failed to resolve report." });
        }
    });
    
    // ... (rest of the file remains the same)
    // To be safe, the full code is provided at the bottom.
    
    // FULL UNCHANGED/NEW CODE FOR SAFETY
    router.get('/stats', async (req, res) => { try { const [ownerCount, channelCount, revenueAggregation, commissionAggregation, paidOutAggregation, pendingPayoutAggregation] = await Promise.all([ Owner.countDocuments(), ManagedChannel.countDocuments(), Transaction.aggregate([{ $group: { _id: null, total: { $sum: '$amount_paid' } } }]), Transaction.aggregate([{ $group: { _id: null, total: { $sum: '$commission_charged' } } }]), Withdrawal.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]), Owner.aggregate([{ $group: { _id: null, total: { $sum: '$wallet_balance' } } }]) ]); res.json({ totalOwners: ownerCount, totalChannels: channelCount, totalRevenue: revenueAggregation[0]?.total || 0, totalCommission: commissionAggregation[0]?.total || 0, totalPaidOut: paidOutAggregation[0]?.total || 0, pendingPayouts: pendingPayoutAggregation[0]?.total || 0 }); } catch (error) { res.status(500).json({ error: 'Failed to fetch stats' }); } });
    router.get('/owners', async (req, res) => { try { const owners = await Owner.find({}).sort({ created_at: -1 }); res.json(owners); } catch (error) { res.status(500).json({ error: 'Failed to fetch owners list' }); } });
    router.get('/owners/:id/channels', async (req, res) => { try { const channels = await ManagedChannel.find({ owner_id: req.params.id }); res.json(channels); } catch (error) { res.status(500).json({ error: "Failed to get owner's channels" }); } });
    router.post('/owners/:id/ban', async (req, res) => { try { const ownerId = req.params.id; const owner = await Owner.findById(ownerId); if (!owner) return res.status(404).send('Owner not found'); const channels = await ManagedChannel.find({ owner_id: ownerId }); await ManagedChannel.deleteMany({ owner_id: ownerId }); owner.is_banned = true; owner.banned_at = new Date(); await owner.save(); let bannedChannels = channels.map(c => c.channel_name).join(', '); await bot.sendMessage(owner.telegram_id, `⚠️ **Your Account Has Been Banned** ⚠️\n\nThis is due to a violation of our terms of service. Your channels (${bannedChannels}) have been removed, and withdrawals are disabled.\n\nPlease contact support: @${process.env.SUPER_ADMIN_USERNAME}`, { parse_mode: 'Markdown' }).catch(err => console.log(`Could not send ban notification to ${owner.telegram_id}`)); res.json({ message: `Owner ${owner.first_name} has been banned successfully.` }); } catch (error) { console.error("Error banning owner:", error); res.status(500).json({ error: 'Failed to ban owner.' }); } });
    router.post('/channels/:id/inspect', async (req, res) => { try { const channel = await ManagedChannel.findById(req.params.id); if (!channel) return res.status(404).send("Channel not found"); const link = await bot.createChatInviteLink(channel.channel_id, { member_limit: 1 }); await bot.sendMessage(process.env.SUPER_ADMIN_ID, `Here is the one-time inspection link for channel *${channel.channel_name}*:\n\n${link.invite_link}`, { parse_mode: 'Markdown' }); res.json({ message: "Success! An invite link has been sent to your Telegram chat." }); } catch (error) { console.error("Inspect link error:", error); res.status(500).json({ error: "Could not create inspect link. Make sure the bot is still an admin in the channel." }); } });
    router.get('/withdrawals', async (req, res) => { try { const requests = await Withdrawal.find({ status: 'pending' }).populate('owner_id', 'first_name telegram_id'); res.json(requests); } catch (error) { res.status(500).json({ error: 'Failed to fetch withdrawal requests' }); } });
    router.post('/withdrawals/:id/approve', async (req, res) => { try { const withdrawal = await Withdrawal.findByIdAndUpdate(req.params.id, { status: 'approved', processed_at: Date.now() }, { new: true }).populate('owner_id', 'telegram_id'); if (!withdrawal) return res.status(404).send('Request not found'); await bot.sendMessage(withdrawal.owner_id.telegram_id, `✅ Your withdrawal request for ₹${withdrawal.amount} has been approved and processed.`); res.json({ message: 'Withdrawal approved successfully!' }); } catch (error) { res.status(500).json({ error: 'Failed to approve request' }); } });
    router.post('/withdrawals/:id/reject', async (req, res) => { try { const withdrawal = await Withdrawal.findById(req.params.id).populate('owner_id', 'telegram_id'); if (!withdrawal) return res.status(404).send('Request not found'); await Owner.findByIdAndUpdate(withdrawal.owner_id._id, { $inc: { wallet_balance: withdrawal.amount } }); withdrawal.status = 'rejected'; withdrawal.processed_at = Date.now(); await withdrawal.save(); await bot.sendMessage(withdrawal.owner_id.telegram_id, `❌ Your withdrawal request for ₹${withdrawal.amount} has been rejected. The amount has been refunded to your wallet.`); res.json({ message: 'Withdrawal rejected and amount refunded.' }); } catch (error) { res.status(500).json({ error: 'Failed to reject request' }); } });

    return router;
};
