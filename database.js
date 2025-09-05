const { MongoClient } = require('mongodb');

let client;
let db;

// MongoDB connection
async function connectToDatabase() {
    if (db) {
        return db;
    }

    try {
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
        client = new MongoClient(uri);
        await client.connect();
        db = client.db('convertfile');
        console.log('Connected to MongoDB');
        return db;
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
}

// Get stats collection
async function getStatsCollection() {
    const database = await connectToDatabase();
    return database.collection('stats');
}

// Load stats from database
async function loadStats() {
    try {
        const collection = await getStatsCollection();
        let stats = await collection.findOne({ _id: 'global' });
        
        if (!stats) {
            // Create initial stats document
            stats = {
                _id: 'global',
                totalVisits: 0,
                totalConversions: 0,
                totalCombines: 0,
                totalPdfToWord: 0,
                dailyStats: {},
                lastUpdated: new Date().toISOString()
            };
            await collection.insertOne(stats);
        }
        
        return stats;
    } catch (error) {
        console.error('Error loading stats from database:', error);
        // Return default stats if database is unavailable
        return {
            totalVisits: 0,
            totalConversions: 0,
            totalCombines: 0,
            totalPdfToWord: 0,
            dailyStats: {},
            lastUpdated: new Date().toISOString()
        };
    }
}

// Save stats to database
async function saveStats(stats) {
    try {
        const collection = await getStatsCollection();
        stats.lastUpdated = new Date().toISOString();
        
        await collection.replaceOne(
            { _id: 'global' },
            { ...stats, _id: 'global' },
            { upsert: true }
        );
    } catch (error) {
        console.error('Error saving stats to database:', error);
    }
}

// Get today's date string
function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

// Track event
async function trackEvent(eventType) {
    try {
        const stats = await loadStats();
        const today = getTodayString();
        
        // Initialize daily stats if needed
        if (!stats.dailyStats[today]) {
            stats.dailyStats[today] = {
                visits: 0,
                conversions: 0,
                combines: 0,
                pdfToWord: 0
            };
        }
        
        // Increment counters
        switch (eventType) {
            case 'visit':
                stats.totalVisits++;
                stats.dailyStats[today].visits++;
                break;
            case 'conversion':
                stats.totalConversions++;
                stats.dailyStats[today].conversions++;
                break;
            case 'combine':
                stats.totalCombines++;
                stats.dailyStats[today].combines++;
                break;
            case 'pdfToWord':
                stats.totalPdfToWord++;
                stats.dailyStats[today].pdfToWord++;
                break;
        }
        
        // Clean up old daily stats (keep only last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        Object.keys(stats.dailyStats).forEach(date => {
            if (new Date(date) < thirtyDaysAgo) {
                delete stats.dailyStats[date];
            }
        });
        
        await saveStats(stats);
        return stats;
    } catch (error) {
        console.error('Error tracking event:', error);
        return null;
    }
}

// Close database connection
async function closeDatabase() {
    if (client) {
        await client.close();
        client = null;
        db = null;
    }
}

module.exports = {
    connectToDatabase,
    loadStats,
    saveStats,
    trackEvent,
    closeDatabase
};
