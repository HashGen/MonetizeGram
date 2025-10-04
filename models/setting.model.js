// --- START OF FILE models/setting.model.js ---

const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    value: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    }
});

module.exports = mongoose.model('Setting', settingSchema);

// --- END OF FILE models/setting.model.js ---
