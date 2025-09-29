const mongoose = require('mongoose');

const pendingPaymentSchema = new mongoose.Schema({
    unique_amount: { type: String, required: true, unique: true },
    subscriber_id: { type: String, required: true },
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
    channel_id: { type: String, required: true },
    plan_days: { type: Number, required: true },
    plan_price: { type: Number, required: true },
    created_at: { type: Date, default: Date.now, expires: '30m' } // Automatically delete after 30 minutes
});

module.exports = mongoose.model('PendingPayment', pendingPaymentSchema);
