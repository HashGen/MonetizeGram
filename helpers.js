const PendingPayment = require('./models/pendingPayment.model');

/**
 * Generates a unique amount by checking the database first.
 * @param {number} baseAmount - The base amount (e.g., 99.00 or withdrawal amount).
 * @returns {Promise<number>} - A unique amount that is guaranteed not to be in PendingPayments.
 */
async function generateAndVerifyUniqueAmount(baseAmount) {
    let attempts = 0;
    while (attempts < 20) { // Safety break after 20 tries
        const randomPaisa = Math.floor(Math.random() * 90) + 10; // 10 se 99 tak
        const candidateAmount = parseFloat((baseAmount + randomPaisa / 100).toFixed(2));
        
        const existing = await PendingPayment.findOne({ unique_amount: candidateAmount });
        if (!existing) {
            return candidateAmount; // Unique amount mil gaya!
        }
        attempts++;
    }
    // Agar 20 baar koshish ke baad bhi unique amount na mile
    throw new Error('Failed to generate a unique payment amount after 20 attempts.');
}

// Is function ko export karein taaki doosri files use kar sakein
module.exports = { generateAndVerifyUniqueAmount };
