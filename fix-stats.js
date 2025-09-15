const { MongoClient } = require('mongodb');
require('dotenv').config();

async function fixStats() {
    try {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            console.error('MONGODB_URI not found');
            return;
        }

        const client = new MongoClient(uri);
        await client.connect();
        const db = client.db('convertfile');
        const collection = db.collection('stats');

        // Get current stats
        let stats = await collection.findOne({ _id: 'global' });
        
        if (stats) {
            console.log('Current stats:', stats);
            
            // Fix the totalPdfToImages field
            if (stats.totalPdfToImages === null || 
                stats.totalPdfToImages === undefined || 
                isNaN(stats.totalPdfToImages)) {
                stats.totalPdfToImages = 0;
            }
            
            // Remove the incorrect totalPdfToImage field (note singular)
            delete stats.totalPdfToImage;
            
            // Fix daily stats
            Object.keys(stats.dailyStats || {}).forEach(date => {
                if (stats.dailyStats[date]) {
                    // Initialize pdfToImages if it doesn't exist, is null, or is NaN
                    if (stats.dailyStats[date].pdfToImages === null || 
                        stats.dailyStats[date].pdfToImages === undefined || 
                        isNaN(stats.dailyStats[date].pdfToImages)) {
                        stats.dailyStats[date].pdfToImages = 0;
                    }
                    // Remove incorrect pdfToImage field (note singular)
                    delete stats.dailyStats[date].pdfToImage;
                }
            });
            
            // Update the record
            await collection.replaceOne(
                { _id: 'global' },
                stats
            );
            
            console.log('Stats fixed successfully!');
            console.log('Updated stats:', await collection.findOne({ _id: 'global' }));
        } else {
            console.log('No stats found, creating new record...');
            const newStats = {
                _id: 'global',
                totalVisits: 0,
                totalConversions: 0,
                totalCombines: 0,
                totalPdfToWord: 0,
                totalPdfToImages: 0,
                dailyStats: {},
                lastUpdated: new Date().toISOString()
            };
            
            await collection.insertOne(newStats);
            console.log('New stats created:', newStats);
        }
        
        await client.close();
    } catch (error) {
        console.error('Error fixing stats:', error);
    }
}

fixStats();
