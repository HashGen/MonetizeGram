const express = require('express');
const Owner = require('../models/owner.model');
const ManagedChannel = require('../models/managedChannel.model');
const Transaction = require('../models/transaction.model');
const Withdrawal = require('../models/withdrawal.model');

module.exports = function(bot) {
    const router = express.Router();

    // Middleware to check if the user is the Super Admin
    const checkSuperAdmin = (req, res, next) => {
        const secret = req.query.secret;
        if (secret !== process.env.SUPER_ADMIN_SECRET) {
            return res.status(403).send('Forbidden: Invalid Super Admin Secret');
        }
        next();
    };

    // This middleware will be used for all routes in this file
    router.use(checkSuperAdmin);

    // Endpoint to get overall platform stats
    router.get('/stats', async (req, res) => {
        try {
            const ownerCount = await Owner.countDocuments();
            const channelCount = await ManagedChannel.countDocuments();
            
            const revenueAggregation = await Transaction.aggregate([
                { $group: { _id: null, total: { $sum: '$amount_paid' } } }
            ]);
            
            const commissionAggregation = await Transaction.aggregate([
                { $group: { _id: null, total: { $sum: '$commission_charged' } } }
            ]);

            res.json({
                totalOwners: ownerCount,
                totalChannels: channelCount,
                totalRevenue: revenueAggregation[0]?.total || 0,
                totalCommission: commissionAggregation[0]?.total || 0
            });
        } catch (error) {
            console.error("Error fetching stats:", error);
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    // Endpoint to get all pending withdrawal requests
    router.get('/withdrawals', async (req, res) => {
        try {
            // Populate fetches owner details from the Owner collection
            const requests = await Withdrawal.find({ status: 'pending' }).populate('owner_id', 'first_name telegram_id');
            res.json(requests);
        } catch (error) {
            console.error("Error fetching withdrawals:", error);
            res.status(500).json({ error: 'Failed to fetch withdrawal requests' });
        }
    });

    // Endpoint to approve a withdrawal request
    router.post('/withdrawals/:id/approve', async (req, res) => {
        try {
            const withdrawal = await Withdrawal.findByIdAndUpdate(req.params.id, {
                status: 'approved',
                processed_at: Date.now()
            }, { new: true }).populate('owner_id', 'telegram_id');

            if (!withdrawal) return res.status(404).send('Request not found');
            
            // Notify the owner that their payment is processed
            await bot.sendMessage(withdrawal.owner_id.telegram_id, `✅ Your withdrawal request for ₹${withdrawal.amount} has been approved and processed.`);

            res.json({ message: 'Withdrawal approved successfully!' });
        } catch (error) {
            console.error("Error approving withdrawal:", error);
            res.status(500).json({ error: 'Failed to approve request' });
        }
    });

    // Endpoint to reject a withdrawal request
    router.post('/withdrawals/:id/reject', async (req, res) => {
        try {
            const withdrawal = await Withdrawal.findById(req.params.id).populate('owner_id', 'telegram_id');
            if (!withdrawal) return res.status(404).send('Request not found');

            // IMPORTANT: Refund the money to the owner's wallet
            await Owner.findByIdAndUpdate(withdrawal.owner_id._id, {
                $inc: { wallet_balance: withdrawal.amount }
            });
            
            // Update the withdrawal status to 'rejected'
            withdrawal.status = 'rejected';
            withdrawal.processed_at = Date.now();
            await withdrawal.save();
            
            // Notify the owner
            await bot.sendMessage(withdrawal.owner_id.telegram_id, `❌ Your withdrawal request for ₹${withdrawal.amount} has been rejected. The amount has been refunded to your wallet.`);

            res.json({ message: 'Withdrawal rejected and amount refunded.' });
        } catch (error) {
            console.error("Error rejecting withdrawal:", error);
            res.status(500).json({ error: 'Failed to reject request' });
        }
    });

    return router;
};
