const { MongoClient } = require('mongodb');

let client;
let db;

// MongoDB connection with better error handling
async function connectToDatabase() {
    if (db) {
        return db;
    }

    try {
        const uri = process.env.MONGODB_URI;
        if (!uri) {
            console.warn('MONGODB_URI not found in environment variables. Database features will be disabled.');
            return null;
        }
        
        client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 5000, // Increased timeout to 5s
            connectTimeoutMS: 10000,
            socketTimeoutMS: 0,
            maxPoolSize: 10, // Increased pool size
            retryWrites: true,
            w: 'majority'
        });
        
        // Set a timeout for the entire connection process
        const connectPromise = client.connect();
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Connection timeout after 8 seconds')), 8000);
        });
        
        await Promise.race([connectPromise, timeoutPromise]);
        db = client.db('convertfile');
        
        // Test the connection
        await db.admin().ping();
        console.log('Connected to MongoDB successfully');
        return db;
    } catch (error) {
        console.error('MongoDB connection error (database features disabled):', error.message);
        if (client) {
            try {
                await client.close();
            } catch (closeError) {
                console.error('Error closing MongoDB client:', closeError.message);
            }
        }
        client = null;
        db = null;
        return null;
    }
}

// Get stats collection with error handling
async function getStatsCollection() {
    const database = await connectToDatabase();
    if (!database) {
        throw new Error('Database not available');
    }
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
        const database = await connectToDatabase();
        if (!database) {
            console.log(`Event tracking skipped (no database): ${eventType}`);
            return null;
        }
        
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
        console.log(`Event tracked: ${eventType}`);
        return stats;
    } catch (error) {
        console.error('Error tracking event:', error.message);
        return null;
    }
}

// Get user activity collection
async function getUserActivityCollection() {
    const database = await connectToDatabase();
    if (!database) {
        throw new Error('Database not available');
    }
    return database.collection('user_activity');
}

// Log detailed user activity
async function logUserActivity(activityData) {
    try {
        const database = await connectToDatabase();
        if (!database) {
            console.log(`User activity logging skipped (no database): ${activityData.action}`);
            return null;
        }
        
        const collection = await getUserActivityCollection();
        
        const activityLog = {
            ...activityData,
            timestamp: new Date(),
            date: getTodayString(),
            _id: undefined // Let MongoDB generate the ID
        };
        
        await collection.insertOne(activityLog);
        console.log(`User activity logged: ${activityData.action} by ${activityData.ip}`);
        return activityLog;
    } catch (error) {
        console.error('Error logging user activity:', error.message);
        return null;
    }
}

// Get user activity stats
async function getUserActivityStats(days = 7) {
    try {
        const collection = await getUserActivityCollection();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        const pipeline = [
            {
                $match: {
                    timestamp: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: {
                        action: '$action',
                        date: '$date'
                    },
                    count: { $sum: 1 },
                    uniqueIPs: { $addToSet: '$ip' },
                    totalFileSize: { $sum: { $ifNull: ['$fileSize', 0] } }
                }
            },
            {
                $group: {
                    _id: '$_id.action',
                    totalCount: { $sum: '$count' },
                    dailyBreakdown: {
                        $push: {
                            date: '$_id.date',
                            count: '$count',
                            uniqueIPs: { $size: '$uniqueIPs' },
                            totalFileSize: '$totalFileSize'
                        }
                    }
                }
            }
        ];
        
        const stats = await collection.aggregate(pipeline).toArray();
        return stats;
    } catch (error) {
        console.error('Error getting user activity stats:', error);
        return [];
    }
}

// Get recent user activities
async function getRecentUserActivities(limit = 100) {
    try {
        const collection = await getUserActivityCollection();
        const activities = await collection
            .find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .toArray();
        
        return activities;
    } catch (error) {
        console.error('Error getting recent user activities:', error);
        return [];
    }
}

// Helper function to extract client info from request
function extractClientInfo(req) {
    const ip = req.headers['x-forwarded-for'] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress ||
               (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
               '127.0.0.1';

    const userAgent = req.headers['user-agent'] || 'Unknown';
    const referer = req.headers['referer'] || req.headers['referrer'] || null;
    
    return {
        ip: Array.isArray(ip) ? ip[0] : ip.split(',')[0].trim(),
        userAgent,
        referer,
        method: req.method,
        url: req.url,
        headers: {
            'accept-language': req.headers['accept-language'],
            'accept-encoding': req.headers['accept-encoding']
        }
    };
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
    closeDatabase,
    logUserActivity,
    getUserActivityStats,
    getRecentUserActivities,
    extractClientInfo
};
