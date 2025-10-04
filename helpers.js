// --- START OF FILE helpers.js ---

const PendingPayment = require('./models/pendingPayment.model');
const Setting = require('./models/setting.model'); // Naya model import kiya

/**
 * --- UPDATED LOGIC ---
 * Generates a unique amount that rolls over to the next integer if the current range is full.
 * e.g., if 99.01-99.99 is full, it moves to 100.01-100.99.
 * @param {number} basePrice - The base price of the plan (e.g., 99).
 * @returns {Promise<number>} - A unique payment amount.
 */
async function generateAndVerifyUniqueAmount(basePrice) {
    const MAX_BASE_AMOUNT = basePrice + 5; // e.g., if price is 99, it will go up to 104.xx
    
    // Get the current base amount from DB, or initialize it.
    let config = await Setting.findOne({ key: 'currentBaseAmount' });
    if (!config || !config.value) {
        config = await Setting.findOneAndUpdate(
            { key: 'currentBaseAmount' },
            { $set: { value: basePrice } },
            { upsert: true, new: true }
        );
    }
    let currentBase = Number(config.value);

    let loopCount = 0; // Safety break
    while (loopCount < 500) { // Try up to 500 different amounts before failing
        // Try to find an unused amount in the current base range (e.g., 99.01 to 99.99)
        for (let i = 1; i <= 99; i++) {
            const paisa = i.toString().padStart(2, '0');
            const potentialAmount = parseFloat(`${currentBase}.${paisa}`);
            
            const existingPayment = await PendingPayment.findOne({ unique_amount: potentialAmount.toFixed(2) });

            if (!existingPayment) {
                // Found a unique amount!
                // Update the current base in DB for the next user
                await Setting.updateOne({ key: 'currentBaseAmount' }, { $set: { value: currentBase } });
                return potentialAmount;
            }
        }

        // If no amount was found in the entire range, increment the base and try again.
        console.log(`Amount range for base ${currentBase} is full. Moving to next integer.`);
        currentBase++;
        
        // If we have exceeded the max limit, reset to the original base price.
        if (currentBase > MAX_BASE_AMOUNT) {
            console.warn(`Max base amount reached. Resetting to original price: ${basePrice}`);
            currentBase = basePrice;
        }

        // Save the new base for the next loop
        await Setting.updateOne({ key: 'currentBaseAmount' }, { $set: { value: currentBase } });
        loopCount++;
    }

    throw new Error('Failed to generate a unique payment amount after 500 attempts. The system is likely full.');
}

module.exports = { generateAndVerifyUniqueAmount };

// --- END OF FILE helpers.js ---
