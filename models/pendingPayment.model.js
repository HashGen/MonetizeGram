// --- START OF FILE models/pendingPayment.model.js ---

const mongoose = require('mongoose');

const pendingPaymentSchema = new mongoose.Schema({
    unique_amount: { type: String, required: true, unique: true },
    subscriber_id: { type: String, required: true },
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
    channel_id: { type: String, required: true }, // The Telegram channel ID
    plan_days: { type: Number, required: true },
    plan_price: { type: Number, required: true },
    channel_id_mongoose: { type: mongoose.Schema.Types.ObjectId, ref: 'ManagedChannel', required: true },
    
    // --- FIX: Expiry time updated from 30 minutes to 2 hours ---
    created_at: { type: Date, default: Date.now, expires: '2h' } // Automatically delete after 2 hours
});

module.exports = mongoose.model('PendingPayment', pendingPaymentSchema);

// --- END OF FILE models/pendingPayment.model.js ---
