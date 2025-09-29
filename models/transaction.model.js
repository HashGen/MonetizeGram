const mongoose = require('mongoose');
const transactionSchema = new mongoose.Schema({
    owner_id: { type: String, required: true, index: true },
    subscriber_id: { type: String, required: true },
    channel_id: { type: String, required: true },
    plan_days: { type: Number, required: true },
    amount_paid: { type: Number, required: true },
    commission_charged: { type: Number, required: true },
    amount_credited_to_owner: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Transaction', transactionSchema);
