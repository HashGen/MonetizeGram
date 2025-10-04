const mongoose = require('mongoose');

const pendingPaymentSchema = new mongoose.Schema({
    subscriber_id: {
        type: String,
        required: true
    },
    owner_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Owner',
        required: true
    },
    channel_id: { // Telegram's numeric chat ID
        type: String, 
        required: true
    },
    channel_id_mongoose: { // Mongoose _id for our internal reference
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ManagedChannel',
        required: true
    },
    plan_days: {
        type: Number,
        required: true
    },
    plan_price: {
        type: Number,
        required: true
    },
    unique_amount: {
        type: Number,
        required: true,
        unique: true // Ensure uniqueness at DB level
    },
    // --- YEH HAI IMPORTANT CHANGE ---
    createdAt: {
        type: Date,
        default: Date.now,
        // This tells MongoDB to automatically delete the document after 2 hours (7200 seconds)
        expires: '2h' 
    }
});

// This creates the TTL index on the `createdAt` field
pendingPaymentSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7200 });

const PendingPayment = mongoose.model('PendingPayment', pendingPaymentSchema);

module.exports = PendingPayment;
