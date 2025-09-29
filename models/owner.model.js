const mongoose = require('mongoose');
const ownerSchema = new mongoose.Schema({
    telegram_id: { type: String, required: true, unique: true },
    username: String,
    first_name: String,
    wallet_balance: { type: Number, default: 0 },
    total_earnings: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Owner', ownerSchema);
