const express = require('express');
const Owner = require('../models/owner.model');
const ManagedChannel = require('../models/managedChannel.model');
const Transaction = require('../models/transaction.model');
const Withdrawal = require('../models/withdrawal.model');

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

    router.get('/stats', async (req, res) => {
        try {
            const [
                ownerCount, 
                channelCount, 
                revenueAggregation, 
                commissionAggregation,
                paidOutAggregation,
                pendingPayoutAggregation // This is the fixed query
            ] = await Promise.all([
                Owner.countDocuments(),
                ManagedChannel.countDocuments(),
                Transaction.aggregate([{ $group: { _id: null, total: { $sum: '$amount_paid' } } }]),
                Transaction.aggregate([{ $group: { _id: null, total: { $sum: '$commission_charged' } } }]),
                Withdrawal.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
                Owner.aggregate([{ $group: { _id: null, total: { $sum: '$wallet_balance' } } }])
            ]);

            res.json({
                totalOwners: ownerCount,
                totalChannels: channelCount,
                totalRevenue: revenueAggregation[0]?.total || 0,
                totalCommission: commissionAggregation[0]?.total || 0,
                totalPaidOut: paidOutAggregation[0]?.total || 0,
                pendingPayouts: pendingPayoutAggregation[0]?.total || 0 // This will now have the correct value
            });
        } catch (error) {
            console.error("Error fetching stats:", error);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });
    
    router.get('/owners', async (req, res) => {
        try { const owners = await Owner.find({}).sort({ created_at: -1 }); res.json(owners); } 
        catch (error) { res.status(500).json({ error: 'Failed to fetch owners list' }); }
    });
    router.get('/withdrawals', async (req, res) => {
        try { const requests = await Withdrawal.find({ status: 'pending' }).populate('owner_id', 'first_name telegram_id'); res.json(requests); } 
        catch (error) { res.status(500).json({ error: 'Failed to fetch withdrawal requests' }); }
    });
    router.post('/withdrawals/:id/approve', async (req, res) => {
        try {
            const withdrawal = await Withdrawal.findByIdAndUpdate(req.params.id, { status: 'approved', processed_at: Date.now() }, { new: true }).populate('owner_id', 'telegram_id');
            if (!withdrawal) return res.status(404).send('Request not found');
            await bot.sendMessage(withdrawal.owner_id.telegram_id, `✅ Your withdrawal request for ₹${withdrawal.amount} has been approved and processed.`);
            res.json({ message: 'Withdrawal approved successfully!' });
        } catch (error) { res.status(500).json({ error: 'Failed to approve request' }); }
    });
    router.post('/withdrawals/:id/reject', async (req, res) => {
        try {
            const withdrawal = await Withdrawal.findById(req.params.id).populate('owner_id', 'telegram_id');
            if (!withdrawal) return res.status(404).send('Request not found');
            await Owner.findByIdAndUpdate(withdrawal.owner_id._id, { $inc: { wallet_balance: withdrawal.amount } });
            withdrawal.status = 'rejected';
            withdrawal.processed_at = Date.now();
            await withdrawal.save();
            await bot.sendMessage(withdrawal.owner_id.telegram_id, `❌ Your withdrawal request for ₹${withdrawal.amount} has been rejected. The amount has been refunded to your wallet.`);
            res.json({ message: 'Withdrawal rejected and amount refunded.' });
        } catch (error) { res.status(500).json({ error: 'Failed to reject request' }); }
    });

    return router;
};
