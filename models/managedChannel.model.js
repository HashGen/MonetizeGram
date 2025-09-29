const mongoose = require('mongoose');
const planSchema = new mongoose.Schema({ _id: false, days: { type: Number, required: true }, price: { type: Number, required: true } });
const managedChannelSchema = new mongoose.Schema({
    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
    channel_id: { type: String, required: true, unique: true },
    channel_name: { type: String, required: true },
    unique_start_key: { type: String, required: true, unique: true },
    plans: [planSchema],
    created_at: { type: Date, default: Date.now }
});
module.exports = mongoose.model('ManagedChannel', managedChannelSchema);
