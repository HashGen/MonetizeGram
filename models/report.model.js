const mongoose = require('mongoose');
const reportSchema = new mongoose.Schema({
    reporter_id: { type: String, required: true },
    reported_owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
    reported_channel_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ManagedChannel', required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ['pending', 'resolved'], default: 'pending' },
    created_at: { type: Date, default: Date.now }
});
module.exports = mongoose.model('Report', reportSchema);
