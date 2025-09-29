const mongoose = require('mongoose');
const withdrawalSchema = new mongoose.Schema({
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
    amount: { type: Number, required: true },
    upi_id: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    requested_at: { type: Date, default: Date.now },
    processed_at: { type: Date }
});
module.exports = mongoose.model('Withdrawal', withdrawalSchema);
