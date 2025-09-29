const mongoose = require('mongoose');
const subscriberSchema = new mongoose.Schema({
    telegram_id: { type: String, required: true },
    channel_id: { type: String, required: true },
    owner_id: { type: String, required: true },
    expires_at: { type: Date, required: true },
    subscribed_at: { type: Date, default: Date.now }
});
subscriberSchema.index({ telegram_id: 1, channel_id: 1 }, { unique: true });
subscriberSchema.index({ expires_at: 1 });
module.exports = mongoose.model('Subscriber', subscriberSchema);
